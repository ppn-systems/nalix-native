pub mod channel;
pub mod client;
pub mod packet;
pub mod status;

pub use channel::{ChannelConfig, ConnectivityState, TransportType};
pub use client::NalixClient;
pub use packet::{Packet, PacketHeader, NALIX_HEADER_SIZE};
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
        assert_eq!(decoded.payload, payload);
    }

    #[test]
    fn test_tcp_transport_roundtrip() {
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind local listener");
        let local_addr = listener.local_addr().expect("Failed to get local addr");

        let server_thread = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("Failed to accept");
            let mut buf = [0u8; 11]; // 6 header + 5 payload
            std::io::Read::read_exact(&mut stream, &mut buf).expect("Server read failed");
            let pkt = Packet::decode(&buf).expect("Server packet decode failed");
            assert_eq!(pkt.header.opcode, 0x1234);
            assert_eq!(pkt.payload, vec![1, 2, 3, 4, 5]);
        });

        let config = ChannelConfig::tcp(local_addr.to_string());
        let mut client = NalixClient::new(config);
        client.connect().expect("TCP connect failed");
        assert!(client.is_connected());

        let header = PacketHeader::new(0x1234, 0x01, 0x02, 0x0001);
        let packet = Packet::new(header, vec![1, 2, 3, 4, 5]);
        client.send(&packet).expect("TCP send failed");

        client.disconnect().expect("TCP disconnect failed");
        server_thread.join().expect("Server thread panicked");
    }

    #[test]
    fn test_client_lifecycle_offline() {
        let config = ChannelConfig::tcp("127.0.0.1:9000");
        let mut client = NalixClient::new(config);
        assert_eq!(client.state(), ConnectivityState::Idle);

        // Attempting to connect to offline port sets TransientFailure
        let _ = client.connect();
        assert_eq!(client.state(), ConnectivityState::TransientFailure);

        client.disconnect().expect("Disconnect should succeed");
        assert_eq!(client.state(), ConnectivityState::Shutdown);
    }
}
