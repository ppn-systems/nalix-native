use crate::status::{Status, StatusCode};

pub const NALIX_HEADER_SIZE: usize = 6;

/// Nalix v14 6-byte wire protocol header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PacketHeader {
    pub opcode: u16,
    pub flags: u8,
    pub priority: u8,
    pub sequence_id: u16,
}

impl PacketHeader {
    pub fn new(opcode: u16, flags: u8, priority: u8, sequence_id: u16) -> Self {
        Self {
            opcode,
            flags,
            priority,
            sequence_id,
        }
    }

    pub fn encode(&self, dst: &mut [u8]) -> Result<(), Status> {
        if dst.len() < NALIX_HEADER_SIZE {
            return Err(Status::new(
                StatusCode::ResourceExhausted,
                "Buffer too small for 6-byte header",
            ));
        }

        let op_bytes = self.opcode.to_le_bytes();
        dst[0] = op_bytes[0];
        dst[1] = op_bytes[1];
        dst[2] = self.flags;
        dst[3] = self.priority;
        let seq_bytes = self.sequence_id.to_le_bytes();
        dst[4] = seq_bytes[0];
        dst[5] = seq_bytes[1];

        Ok(())
    }

    pub fn decode(src: &[u8]) -> Result<Self, Status> {
        if src.len() < NALIX_HEADER_SIZE {
            return Err(Status::new(
                StatusCode::OutOfRange,
                "Buffer too small for 6-byte header",
            ));
        }

        let opcode = u16::from_le_bytes([src[0], src[1]]);
        let flags = src[2];
        let priority = src[3];
        let sequence_id = u16::from_le_bytes([src[4], src[5]]);

        Ok(Self {
            opcode,
            flags,
            priority,
            sequence_id,
        })
    }
}

/// A Nalix protocol packet composed of a header and an optional payload.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Packet {
    pub header: PacketHeader,
    pub payload: Vec<u8>,
}

impl Packet {
    pub fn new(header: PacketHeader, payload: Vec<u8>) -> Self {
        Self { header, payload }
    }

    /// High-level constructor from opcode and payload.
    pub fn create(opcode: u16, payload: impl Into<Vec<u8>>) -> Self {
        Self {
            header: PacketHeader::new(opcode, 0, 0, 0),
            payload: payload.into(),
        }
    }

    /// High-level constructor from opcode, sequence ID, and payload.
    pub fn with_sequence(opcode: u16, sequence_id: u16, payload: impl Into<Vec<u8>>) -> Self {
        Self {
            header: PacketHeader::new(opcode, 0, 0, sequence_id),
            payload: payload.into(),
        }
    }

    /// Helper to read payload as a UTF-8 string slice.
    pub fn as_str(&self) -> Result<&str, std::str::Utf8Error> {
        std::str::from_utf8(&self.payload)
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut buf = vec![0u8; NALIX_HEADER_SIZE + self.payload.len()];
        self.header.encode(&mut buf[..NALIX_HEADER_SIZE]).unwrap();
        buf[NALIX_HEADER_SIZE..].copy_from_slice(&self.payload);
        buf
    }

    pub fn decode(src: &[u8]) -> Result<Self, Status> {
        let header = PacketHeader::decode(src)?;
        let payload = src[NALIX_HEADER_SIZE..].to_vec();
        Ok(Self { header, payload })
    }
}
