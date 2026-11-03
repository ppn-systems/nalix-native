use crate::channel::{ChannelConfig, ConnectivityState};
use crate::packet::Packet;
use crate::status::{Status, StatusCode};

/// Client interface managing connection lifecycle and packet dispatch.
#[derive(Debug)]
pub struct NalixClient {
    config: ChannelConfig,
    state: ConnectivityState,
}

impl NalixClient {
    pub fn new(config: ChannelConfig) -> Self {
        Self {
            config,
            state: ConnectivityState::Idle,
        }
    }

    pub fn state(&self) -> ConnectivityState {
        self.state
    }

    pub fn config(&self) -> &ChannelConfig {
        &self.config
    }

    pub fn connect(&mut self) -> Result<(), Status> {
        if self.state == ConnectivityState::Ready {
            return Ok(());
        }

        self.state = ConnectivityState::Connecting;
        // Network transport integration will be implemented in dedicated client phase
        self.state = ConnectivityState::Ready;
        Ok(())
    }

    pub fn send(&self, _packet: &Packet) -> Result<(), Status> {
        if self.state != ConnectivityState::Ready {
            return Err(Status::new(
                StatusCode::Unavailable,
                "Channel is not connected",
            ));
        }

        // Socket write implementation will be added in dedicated client phase
        Ok(())
    }

    pub fn disconnect(&mut self) -> Result<(), Status> {
        self.state = ConnectivityState::Shutdown;
        Ok(())
    }
}
