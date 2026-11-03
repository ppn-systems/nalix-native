use std::time::Duration;

/// Connectivity states representing the channel lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ConnectivityState {
    #[default]
    Idle,
    Connecting,
    Ready,
    TransientFailure,
    Shutdown,
}

impl ConnectivityState {
    pub fn as_str(&self) -> &'static str {
        match self {
            ConnectivityState::Idle => "IDLE",
            ConnectivityState::Connecting => "CONNECTING",
            ConnectivityState::Ready => "READY",
            ConnectivityState::TransientFailure => "TRANSIENT_FAILURE",
            ConnectivityState::Shutdown => "SHUTDOWN",
        }
    }
}

/// Transport type selection for the client channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportType {
    Tcp,
    WebSocket {
        path: String,
        subprotocol: Option<String>,
        use_tls: bool,
    },
}

impl Default for TransportType {
    fn default() -> Self {
        TransportType::Tcp
    }
}

/// Configuration parameters for establishing a Nalix channel.
#[derive(Debug, Clone)]
pub struct ChannelConfig {
    pub endpoint: String,
    pub transport: TransportType,
    pub connect_timeout: Duration,
    pub request_timeout: Duration,
    pub keepalive_interval: Duration,
    pub max_message_size: usize,
}

impl Default for ChannelConfig {
    fn default() -> Self {
        Self {
            endpoint: "127.0.0.1:9000".to_string(),
            transport: TransportType::Tcp,
            connect_timeout: Duration::from_secs(5),
            request_timeout: Duration::from_secs(10),
            keepalive_interval: Duration::from_secs(30),
            max_message_size: 65536,
        }
    }
}

impl ChannelConfig {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            ..Default::default()
        }
    }

    pub fn tcp(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            transport: TransportType::Tcp,
            ..Default::default()
        }
    }

    pub fn websocket(
        host: impl Into<String>,
        port: u16,
        path: impl Into<String>,
        use_tls: bool,
        subprotocol: Option<impl Into<String>>,
    ) -> Self {
        let host_str = host.into();
        Self {
            endpoint: format!("{}:{}", host_str, port),
            transport: TransportType::WebSocket {
                path: path.into(),
                subprotocol: subprotocol.map(|s| s.into()),
                use_tls,
            },
            ..Default::default()
        }
    }
}
