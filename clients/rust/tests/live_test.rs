use nalix_client::channel::ConnectivityState;
use nalix_client::packet::Packet;
use nalix_client::session::WebSocketSession;

#[test]
fn test_live_websocket_connection() {
    println!("Connecting live to atmosos.eyc.asia:443 via WebSocketSession...");
    let mut session = WebSocketSession::connect_to("atmosos.eyc.asia:443", "/ws/", true)
        .expect("WebSocket connection should succeed");

    assert_eq!(session.state(), ConnectivityState::Ready);
    assert!(session.is_connected());
    println!("Connected successfully to atmosos.eyc.asia:443 via WebSocketSession!");

    // Send a SessionInit packet (OpCode: 0x0000, 64-byte payload) using convenient create() helper
    let payload = vec![0x42u8; 64];
    let pkt = Packet::create(0x0000, payload);

    let send_res = session.send(&pkt);
    assert!(send_res.is_ok(), "Failed to send packet: {:?}", send_res.err());
    println!("Sent SessionInit packet successfully!");

    // Disconnect
    let disc_res = session.disconnect();
    assert!(disc_res.is_ok(), "Failed to disconnect: {:?}", disc_res.err());
    assert_eq!(session.state(), ConnectivityState::Shutdown);
    println!("Disconnected cleanly.");
}
