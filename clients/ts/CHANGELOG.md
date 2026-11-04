# Changelog

All notable changes to `@ppnsys/nalix-sdk` are listed here. Earlier history is in the git log.

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
