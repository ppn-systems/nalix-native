pub mod channel;
pub mod client;
pub mod packet;
pub mod status;

pub use channel::{ChannelConfig, ConnectivityState};
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
    fn test_client_lifecycle() {
        let config = ChannelConfig::new("127.0.0.1:9000");
        let mut client = NalixClient::new(config);
        assert_eq!(client.state(), ConnectivityState::Idle);

        client.connect().expect("Connect should succeed");
        assert_eq!(client.state(), ConnectivityState::Ready);

        let packet = Packet::new(PacketHeader::default(), vec![]);
        client.send(&packet).expect("Send should succeed");

        client.disconnect().expect("Disconnect should succeed");
        assert_eq!(client.state(), ConnectivityState::Shutdown);
    }
}
