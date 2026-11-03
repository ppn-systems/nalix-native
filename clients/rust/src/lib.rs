pub mod channel;
pub mod packet;
pub mod session;
pub mod status;

pub use channel::{ChannelConfig, ConnectivityState, TransportType};
pub use packet::{Packet, PacketHeader, NALIX_HEADER_SIZE};
pub use session::{TcpSession, TransportSession, WebSocketSession};
pub use status::{Status, StatusCode};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_codes() {
        let ok = Status::ok();
        assert!(ok.is_ok());
        assert_eq!(ok.code(), StatusCode::Ok);
        assert_eq!(StatusCode::InvalidArgument.as_str(), "INVALID_ARGUMENT");

        let err = Status::new(StatusCode::NotFound, "Resource missing");
        assert!(!err.is_ok());
        assert_eq!(err.code(), StatusCode::NotFound);
        assert_eq!(err.message(), "Resource missing");
    }

    #[test]
    fn test_packet_encode_decode() {
        let header = PacketHeader::new(0x1234, 0x01, 0x02, 0x5678);
        let payload = vec![1, 2, 3, 4, 5];
        let packet = Packet::new(header, payload.clone());

        let encoded = packet.encode();
        assert_eq!(encoded.len(), NALIX_HEADER_SIZE + payload.len());

        // Check little-endian wire bytes
        assert_eq!(encoded[0], 0x34);
        assert_eq!(encoded[1], 0x12);
        assert_eq!(encoded[2], 0x01);
        assert_eq!(encoded[3], 0x02);
        assert_eq!(encoded[4], 0x78);
        assert_eq!(encoded[5], 0x56);
        assert_eq!(&encoded[6..], &payload[..]);

        let decoded = Packet::decode(&encoded).expect("Decode should succeed");
        assert_eq!(decoded.header.opcode, 0x1234);
        assert_eq!(decoded.header.flags, 0x01);
        assert_eq!(decoded.header.priority, 0x02);
        assert_eq!(decoded.header.sequence_id, 0x5678);
    }

    #[test]
    fn test_tcp_transport_roundtrip() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral TCP port");
        let local_addr = listener.local_addr().unwrap();

        let server_thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("Failed to accept connection");
            let mut buf = [0u8; 128];
            let bytes_read = stream.read(&mut buf).expect("Failed to read");
            assert!(bytes_read >= NALIX_HEADER_SIZE);

            // Echo packet back with OpCode incremented
            let mut resp_header = PacketHeader::decode(&buf[..NALIX_HEADER_SIZE]).unwrap();
            resp_header.opcode += 1;
            let resp_packet = Packet::new(resp_header, buf[NALIX_HEADER_SIZE..bytes_read].to_vec());
            stream
                .write_all(&resp_packet.encode())
                .expect("Failed to echo");
        });

        let mut session = TcpSession::new(local_addr.to_string());
        assert_eq!(session.state(), ConnectivityState::Idle);

        // Connect
        session.connect().expect("Connect should succeed");
        assert_eq!(session.state(), ConnectivityState::Ready);
        assert!(session.is_connected());

        // Send & Receive
        let header = PacketHeader::new(0x0100, 0, 0, 1);
        let packet = Packet::new(header, b"PING".to_vec());
        session.send(&packet).expect("Send should succeed");

        let response = session.receive().expect("Receive should succeed");
        assert_eq!(response.header.opcode, 0x0101);
        assert_eq!(response.payload, b"PING".to_vec());

        // Disconnect
        session.disconnect().expect("Disconnect should succeed");
        assert_eq!(session.state(), ConnectivityState::Shutdown);

        server_thread.join().unwrap();
    }

    #[test]
    fn test_session_lifecycle_offline() {
        let mut session = TcpSession::new("127.0.0.1:1"); // Non-existent port
        let res = session.connect();
        assert!(res.is_err());
        assert_eq!(session.state(), ConnectivityState::TransientFailure);
    }
}
