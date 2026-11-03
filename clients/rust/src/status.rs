use std::fmt;

/// Canonical status codes for Nalix client operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum StatusCode {
    Ok = 0,
    Cancelled = 1,
    Unknown = 2,
    InvalidArgument = 3,
    DeadlineExceeded = 4,
    NotFound = 5,
    AlreadyExists = 6,
    PermissionDenied = 7,
    ResourceExhausted = 8,
    FailedPrecondition = 9,
    Aborted = 10,
    OutOfRange = 11,
    Unimplemented = 12,
    Internal = 13,
    Unavailable = 14,
    DataLoss = 15,
    Unauthenticated = 16,
}

impl StatusCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            StatusCode::Ok => "OK",
            StatusCode::Cancelled => "CANCELLED",
            StatusCode::Unknown => "UNKNOWN",
            StatusCode::InvalidArgument => "INVALID_ARGUMENT",
            StatusCode::DeadlineExceeded => "DEADLINE_EXCEEDED",
            StatusCode::NotFound => "NOT_FOUND",
            StatusCode::AlreadyExists => "ALREADY_EXISTS",
            StatusCode::PermissionDenied => "PERMISSION_DENIED",
            StatusCode::ResourceExhausted => "RESOURCE_EXHAUSTED",
            StatusCode::FailedPrecondition => "FAILED_PRECONDITION",
            StatusCode::Aborted => "ABORTED",
            StatusCode::OutOfRange => "OUT_OF_RANGE",
            StatusCode::Unimplemented => "UNIMPLEMENTED",
            StatusCode::Internal => "INTERNAL",
            StatusCode::Unavailable => "UNAVAILABLE",
            StatusCode::DataLoss => "DATA_LOSS",
            StatusCode::Unauthenticated => "UNAUTHENTICATED",
        }
    }
}

impl fmt::Display for StatusCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Status represents the result of a Nalix client call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    code: StatusCode,
    message: String,
}

impl Status {
    pub fn new(code: StatusCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn ok() -> Self {
        Self {
            code: StatusCode::Ok,
            message: "OK".to_string(),
        }
    }

    pub fn is_ok(&self) -> bool {
        self.code == StatusCode::Ok
    }

    pub fn code(&self) -> StatusCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for Status {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Status {}
