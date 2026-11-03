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

/// Client interface managing connection lifecycle and packet dispatch.
pub struct NalixClient {
    config: ChannelConfig,
    state: ConnectivityState,
    transport: ActiveTransport,
}

impl NalixClient {
    pub fn new(config: ChannelConfig) -> Self {
        Self {
            config,
            state: ConnectivityState::Idle,
            transport: ActiveTransport::None,
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

                // Read available payload
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
