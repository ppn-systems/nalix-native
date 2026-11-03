use nalix_client::channel::{ChannelConfig, ConnectivityState};
use nalix_client::client::NalixClient;
use nalix_client::packet::{Packet, PacketHeader};

#[test]
fn test_live_websocket_connection() {
    let config = ChannelConfig::websocket(
        "atmosos.eyc.asia",
        443,
        "/ws/",
        true,
        Some("nalix.v1"),
    );

    let mut client = NalixClient::new(config);
    println!("Connecting live to atmosos.eyc.asia:443...");
    let res = client.connect();
    assert!(res.is_ok(), "Failed to connect: {:?}", res.err());
    assert_eq!(client.state(), ConnectivityState::Ready);
    println!("Connected successfully to atmosos.eyc.asia:443 via WebSocket!");

    // Send a SessionInit packet (OpCode: 0x0000, 70 bytes)
    let header = PacketHeader::new(0x0000, 0x04, 0x03, 0x0000);
    let payload = vec![0x42u8; 64]; // dummy 32-byte key + 32-byte nonce
    let pkt = Packet::new(header, payload);

    let send_res = client.send(&pkt);
    assert!(send_res.is_ok(), "Failed to send packet: {:?}", send_res.err());
    println!("Sent SessionInit packet successfully!");

    // Disconnect
    let disc_res = client.disconnect();
    assert!(disc_res.is_ok(), "Failed to disconnect: {:?}", disc_res.err());
    assert_eq!(client.state(), ConnectivityState::Shutdown);
    println!("Disconnected cleanly.");
}
