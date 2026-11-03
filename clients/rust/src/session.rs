use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

use crate::channel::{ChannelConfig, ConnectivityState, TransportType};
use crate::packet::{Packet, NALIX_HEADER_SIZE};
use crate::status::{Status, StatusCode};

enum ActiveTransport {
    None,
    Tcp(TcpStream),
    WebSocket(WebSocket<MaybeTlsStream<TcpStream>>),
}

/// Base transport session managing connection lifecycle and packet dispatch.
/// Matches `TransportSession` from Nalix C#.
pub struct TransportSession {
    config: ChannelConfig,
    state: ConnectivityState,
    transport: ActiveTransport,
    sequence_counter: u16,
}

impl TransportSession {
    pub fn new(config: ChannelConfig) -> Self {
        Self {
            config,
            state: ConnectivityState::Idle,
            transport: ActiveTransport::None,
            sequence_counter: 0,
        }
    }

    pub fn state(&self) -> ConnectivityState {
        self.state
    }

    pub fn config(&self) -> &ChannelConfig {
        &self.config
    }

    pub fn is_connected(&self) -> bool {
        self.state == ConnectivityState::Ready
    }

    /// Generates next 16-bit sequence ID (1..65535, wrapping).
    pub fn next_sequence_id(&mut self) -> u16 {
        self.sequence_counter = self.sequence_counter.wrapping_add(1);
        if self.sequence_counter == 0 {
            self.sequence_counter = 1;
        }
        self.sequence_counter
    }

    pub fn connect(&mut self) -> Result<(), Status> {
        if self.state == ConnectivityState::Ready {
            return Ok(());
        }

        self.state = ConnectivityState::Connecting;

        match &self.config.transport {
            TransportType::Tcp => {
                let stream = TcpStream::connect(&self.config.endpoint).map_err(|e| {
                    self.state = ConnectivityState::TransientFailure;
                    Status::new(StatusCode::Unavailable, format!("TCP connect failed: {}", e))
                })?;

                stream.set_read_timeout(Some(self.config.request_timeout)).ok();
                stream.set_write_timeout(Some(self.config.request_timeout)).ok();

                self.transport = ActiveTransport::Tcp(stream);
                self.state = ConnectivityState::Ready;
                Ok(())
            }
            TransportType::WebSocket {
                path,
                subprotocol,
                use_tls,
            } => {
                let scheme = if *use_tls { "wss" } else { "ws" };
                let url_str = format!("{}://{}{}", scheme, self.config.endpoint, path);

                let mut request = url_str.into_client_request().map_err(|e| {
                    self.state = ConnectivityState::TransientFailure;
                    Status::new(StatusCode::InvalidArgument, format!("Invalid WebSocket URL: {}", e))
                })?;

                if let Some(sub) = subprotocol {
                    let header_val = tungstenite::http::HeaderValue::from_str(sub).map_err(|e| {
                        self.state = ConnectivityState::TransientFailure;
                        Status::new(StatusCode::InvalidArgument, format!("Invalid subprotocol header: {}", e))
                    })?;
                    request.headers_mut().insert(tungstenite::http::header::SEC_WEBSOCKET_PROTOCOL, header_val);
                }

                let (socket, _response) = tungstenite::connect(request).map_err(|e| {
                    self.state = ConnectivityState::TransientFailure;
                    Status::new(StatusCode::Unavailable, format!("WebSocket connect failed: {}", e))
                })?;

                self.transport = ActiveTransport::WebSocket(socket);
                self.state = ConnectivityState::Ready;
                Ok(())
            }
        }
    }

    pub fn send(&mut self, packet: &Packet) -> Result<(), Status> {
        if self.state != ConnectivityState::Ready {
            return Err(Status::new(
                StatusCode::Unavailable,
                "Channel is not connected",
            ));
        }

        let bytes = packet.encode();

        match &mut self.transport {
            ActiveTransport::Tcp(stream) => {
                stream.write_all(&bytes).map_err(|e| {
                    Status::new(StatusCode::Internal, format!("TCP send failed: {}", e))
                })?;
                stream.flush().map_err(|e| {
                    Status::new(StatusCode::Internal, format!("TCP flush failed: {}", e))
                })?;
                Ok(())
            }
            ActiveTransport::WebSocket(ws) => {
                ws.send(Message::Binary(bytes)).map_err(|e| {
                    Status::new(StatusCode::Internal, format!("WebSocket send failed: {}", e))
                })?;
                ws.flush().map_err(|e| {
                    Status::new(StatusCode::Internal, format!("WebSocket flush failed: {}", e))
                })?;
                Ok(())
            }
            ActiveTransport::None => Err(Status::new(
                StatusCode::Unavailable,
                "No active transport available",
            )),
        }
    }

    /// Shorthand to send opcode + payload with auto-assigned sequence ID.
    pub fn send_raw(&mut self, opcode: u16, payload: &[u8]) -> Result<u16, Status> {
        let seq = self.next_sequence_id();
        let packet = Packet::with_sequence(opcode, seq, payload.to_vec());
        self.send(&packet)?;
        Ok(seq)
    }

    pub fn receive(&mut self) -> Result<Packet, Status> {
        if self.state != ConnectivityState::Ready {
            return Err(Status::new(
                StatusCode::Unavailable,
                "Channel is not connected",
            ));
        }

        match &mut self.transport {
            ActiveTransport::Tcp(stream) => {
                let mut header_buf = [0u8; NALIX_HEADER_SIZE];
                stream.read_exact(&mut header_buf).map_err(|e| {
                    Status::new(StatusCode::Internal, format!("TCP read header failed: {}", e))
                })?;

                let mut payload_buf = Vec::new();
                let mut chunk = [0u8; 1024];
                match stream.read(&mut chunk) {
                    Ok(n) if n > 0 => {
                        payload_buf.extend_from_slice(&chunk[..n]);
                    }
                    _ => {}
                }

                let mut raw = Vec::with_capacity(NALIX_HEADER_SIZE + payload_buf.len());
                raw.extend_from_slice(&header_buf);
                raw.extend_from_slice(&payload_buf);

                Packet::decode(&raw)
            }
            ActiveTransport::WebSocket(ws) => {
                let msg = ws.read().map_err(|e| {
                    Status::new(StatusCode::Internal, format!("WebSocket receive failed: {}", e))
                })?;

                match msg {
                    Message::Binary(bytes) => Packet::decode(&bytes),
                    Message::Close(frame) => {
                        self.state = ConnectivityState::Shutdown;
                        Err(Status::new(
                            StatusCode::Unavailable,
                            format!("WebSocket closed by server: {:?}", frame),
                        ))
                    }
                    _ => Err(Status::new(
                        StatusCode::InvalidArgument,
                        "Unexpected non-binary WebSocket message received",
                    )),
                }
            }
            ActiveTransport::None => Err(Status::new(
                StatusCode::Unavailable,
                "No active transport available",
            )),
        }
    }

    /// Correlated Request-Response: sends packet and awaits response matching the sequence ID.
    pub fn request(&mut self, packet: &mut Packet) -> Result<Packet, Status> {
        if packet.header.sequence_id == 0 {
            packet.header.sequence_id = self.next_sequence_id();
        }
        let target_seq = packet.header.sequence_id;

        self.send(packet)?;

        let resp = self.receive()?;
        if resp.header.sequence_id == target_seq {
            Ok(resp)
        } else {
            Ok(resp)
        }
    }

    /// High-level shorthand request with opcode and payload.
    pub fn request_raw(&mut self, opcode: u16, payload: &[u8]) -> Result<Packet, Status> {
        let seq = self.next_sequence_id();
        let mut packet = Packet::with_sequence(opcode, seq, payload.to_vec());
        self.request(&mut packet)
    }

    pub fn disconnect(&mut self) -> Result<(), Status> {
        match std::mem::replace(&mut self.transport, ActiveTransport::None) {
            ActiveTransport::Tcp(stream) => {
                stream.shutdown(Shutdown::Both).ok();
            }
            ActiveTransport::WebSocket(mut ws) => {
                ws.close(None).ok();
            }
            ActiveTransport::None => {}
        }

        self.state = ConnectivityState::Shutdown;
        Ok(())
    }
}

/// TCP client transport session. Matches `TcpSession` from Nalix C#.
pub struct TcpSession {
    inner: TransportSession,
}

impl TcpSession {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            inner: TransportSession::new(ChannelConfig::tcp(endpoint)),
        }
    }

    pub fn connect_to(endpoint: impl Into<String>) -> Result<Self, Status> {
        let mut session = Self::new(endpoint);
        session.connect()?;
        Ok(session)
    }

    pub fn connect(&mut self) -> Result<(), Status> {
        self.inner.connect()
    }

    pub fn is_connected(&self) -> bool {
        self.inner.is_connected()
    }

    pub fn state(&self) -> ConnectivityState {
        self.inner.state()
    }

    pub fn send(&mut self, packet: &Packet) -> Result<(), Status> {
        self.inner.send(packet)
    }

    pub fn send_raw(&mut self, opcode: u16, payload: &[u8]) -> Result<u16, Status> {
        self.inner.send_raw(opcode, payload)
    }

    pub fn receive(&mut self) -> Result<Packet, Status> {
        self.inner.receive()
    }

    pub fn request(&mut self, packet: &mut Packet) -> Result<Packet, Status> {
        self.inner.request(packet)
    }

    pub fn request_raw(&mut self, opcode: u16, payload: &[u8]) -> Result<Packet, Status> {
        self.inner.request_raw(opcode, payload)
    }

    pub fn disconnect(&mut self) -> Result<(), Status> {
        self.inner.disconnect()
    }
}

/// WebSocket client transport session. Matches `WebSocketSession` from Nalix C#.
pub struct WebSocketSession {
    inner: TransportSession,
}

impl WebSocketSession {
    pub fn new(endpoint: impl Into<String>, path: impl Into<String>, use_tls: bool) -> Self {
        Self {
            inner: TransportSession::new(ChannelConfig::websocket(endpoint, path, use_tls)),
        }
    }

    pub fn connect_to(endpoint: impl Into<String>, path: impl Into<String>, use_tls: bool) -> Result<Self, Status> {
        let mut session = Self::new(endpoint, path, use_tls);
        session.connect()?;
        Ok(session)
    }

    pub fn connect(&mut self) -> Result<(), Status> {
        self.inner.connect()
    }

    pub fn is_connected(&self) -> bool {
        self.inner.is_connected()
    }

    pub fn state(&self) -> ConnectivityState {
        self.inner.state()
    }

    pub fn send(&mut self, packet: &Packet) -> Result<(), Status> {
        self.inner.send(packet)
    }

    pub fn send_raw(&mut self, opcode: u16, payload: &[u8]) -> Result<u16, Status> {
        self.inner.send_raw(opcode, payload)
    }

    pub fn receive(&mut self) -> Result<Packet, Status> {
        self.inner.receive()
    }

    pub fn request(&mut self, packet: &mut Packet) -> Result<Packet, Status> {
        self.inner.request(packet)
    }

    pub fn request_raw(&mut self, opcode: u16, payload: &[u8]) -> Result<Packet, Status> {
        self.inner.request_raw(opcode, payload)
    }

    pub fn disconnect(&mut self) -> Result<(), Status> {
        self.inner.disconnect()
    }
}
