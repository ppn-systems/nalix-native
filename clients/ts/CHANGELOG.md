# Changelog

All notable changes to `@ppnsys/nalix-sdk` are listed here. Earlier history is in the git log.

## 0.2.0 - 2026-11-26

Targets **Nalix 14.4.1** (previously 14.3.9). Ports the client-relevant protocol changes of Nalix 14.3.10, 14.4.0
and 14.4.1. No change to the 6-byte frame header, the envelope format or the handshake cryptography.

### Fixed

- **Rekey switches keys at the same point as the host.** The host switches to the new key (and restarts its
  sequence counters) as soon as it reads `SESSION_REKEY`, but the SDK switched only when `SESSION_REKEY_ACK`
  arrived. Any frame sent in between was encrypted under the old key and could not be decrypted by the host.
  `rekey()` now switches the key and restarts both sequence counters right after the request is written, keeps
  the new key if the ACK is lost, and leaves the old key in place if the request could not be sent (nalix#510).
- **Sequence counters follow the host.** A full handshake restarts both envelope sequence directions at 0 (the host
  restarts its own when it installs the key, nalix#545), a rekey restarts them, and connect/resume keep them (the
  host restores its counters on resume, nalix#479). Previously the counter never restarted, and a session
  resumed from a new session object started again at 1, below the host's restored counter.
- **The send counter no longer wraps.** At 2^32 - 1 it throws `RESOURCE_EXHAUSTED` instead of reusing sequence
  numbers under the same key.
- **Resume fallback uses a fresh connection.** After the host rejects a resume it ends the connection;
  `connectWithResume()` now always reconnects before the fallback handshake instead of racing the close.
  A connection lost during resume returns `NETWORK_ERROR` rather than throwing.
- **Auto-reconnect re-authenticates.** A reconnected transport of an authenticated session now runs
  `connectWithResume()` before the backoff resets. Before, it kept sending frames under a key the new connection
  did not know, and hosts close unauthenticated connections after their handshake timeout (nalix#486).
  `disconnect()` during a reconnect stops it. New option `resumeOnReconnect` (default `true`).
- **A late close event of a replaced socket** no longer drains the requests or changes the state of the new
  connection.
- **A failed handshake** clears the half-installed key and token.

### Added

- **Proof-of-work admission.** When the host answers `SESSION_INIT` with `ERROR` / `POW_REQUIRED`, the handshake
  sends `POW_REQUEST`, solves the `POW_CHALLENGE` (`solvePowChallenge`), sends `POW_PROOF` and re-sends
  `SESSION_INIT`. The solve yields to the event loop and is bounded by the handshake timeout (nalix#469).
- **Inbound replay protection.** Encrypted frames are checked against a 32-slot sliding window (`SequenceCounter`,
  a port of the host's). Replays are dropped and reported through `onError` with `ALREADY_EXISTS` /
  `REPLAY_DETECTED`, without failing pending requests.
- **Server FAIL directives fail the request.** A `SYSTEM_DIRECTIVE` `FAIL` that echoes a request's sequence ID and
  names its opcode in `Arg0` (the host sends `RATE_LIMITED` / `RETRY` / `IS_TRANSIENT` when it drops a request under
  backpressure, nalix#520) rejects that request at once with `RESOURCE_EXHAUSTED` (or the status matching the
  reason) instead of a timeout. `decodeDirective`, `encodeDirective`, `directiveToStatus`.
- **WebSocket close status.** Requests drained by a close reject with the close code and reason in
  `NalixStatus.details` (`1001` -> `UNAVAILABLE` / `SERVER_SHUTDOWN`, `1009` -> `RESOURCE_EXHAUSTED`), matching the
  close frames the host now sends (nalix#519, #534, #544). `session.lastClose` records how the last connection ended.
- **Bounded closing handshake.** `disconnect()` waits for the peer's close frame for at most 2 s
  (`CLOSE_HANDSHAKE_TIMEOUT_MS`, the host's bound) so frames written just before, such as the `DISCONNECT` of
  `disconnectGracefully()`, are delivered. The state still becomes `SHUTDOWN` immediately.
- `NalixStatus.details` (`reason`, `advice`, `transient`, `closeCode`, `closeReason`).
- Protocol constants: `ProtocolOpCode.DATAGRAM_TICKET` (0x000C), `TUNNEL_CHALLENGE` (0x00F1), `TUNNEL_PROOF`
  (0x00F2) and the other extension opcodes; the complete `ProtocolReason` table; `ProtocolAdvice`; `ControlFlags`.
- `SDK_VERSION`, `NALIX_TARGET_VERSION` (`'14.4.1'`), `NALIX_PROTOCOL_MAJOR`.
- `resetSequenceCounters()` and `reconnectForResumeFallback()` on sessions, as in the C# SDK.

### Changed

- The handshake fetches the TOFU key after `SESSION_CHALLENGE`, as the C# SDK does, and sends every handshake
  frame explicitly in plaintext. `timeoutMs` now bounds the whole handshake, not each step.
- `SessionState` holds the envelope sequence counters (`sendSequence`, `receiveSequence`); `reset()` clears them.
- The default request matcher no longer treats a `SYSTEM_DIRECTIVE` with the same sequence ID as the reply.
- `PacketFlags.RELIABLE`, `UNRELIABLE` and `ACKNOWLEDGED` are deprecated: Nalix 14.4.0 removed them.

### Not ported

- Datagram sessions (NDP, `DatagramSession`, `DATAGRAM_TICKET` exchange): browsers have no UDP socket. Only the
  opcode is defined.
- Graceful-close drain on the host side (nalix#554): merged after 14.4.1 and not in a release yet. The browser
  WebSocket already reads until the peer's close frame.
- .NET-only changes: buffer leases, analyzers, pooling, telemetry, sample and benchmark updates.

## 0.1.3 - 2026-11-04

### Fixed

- **LZ4 payloads from the Nalix host no longer fail.** `FrameCompression` now reads and writes the raw LZ4 block format, as the host does. Previously it used the LZ4 *frame* format, so every compressed reply failed with `DATA_LOSS: invalid magic number`, the frame was dropped, and the request timed out with `DEADLINE_EXCEEDED`. Compressed client-to-server frames were also invalid.
- **Encoder honours the LZ4 end-of-block rules.** The last 5 bytes are literals and the last match starts at least 12 bytes before the end. Blocks that break these are rejected by the reference decoder.
- **Corrupt or inconsistent compressed input is rejected.** The decoder bounds-checks every read and write. It returns `DATA_LOSS` for truncated blocks, invalid match offsets, a `CompressedLength` that does not match the frame, a decoded size that differs from `OriginalLength`, or an implausible expansion ratio. Out-of-range `OriginalLength` (<= 0 or above 64 MiB) returns `INVALID_ARGUMENT`.
- **Inbound decode failures are no longer swallowed.** When an inbound frame fails to decrypt, decompress or parse, the pending request whose sequence ID matches the frame is rejected with that failure status. Frames larger than `maxMessageSize` are reported the same way.

### Added

- `onError(callback)` on sessions. It receives a `NalixStatus` for every inbound frame that could not be decoded, including frames with no matching request.

### Changed

- Removed the `lz4js` and `@types/lz4js` dependencies. LZ4 encoding and decoding are implemented in `src/compression.ts`. The test suite checks them against golden frames produced by the reference LZ4 library.
