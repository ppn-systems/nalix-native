# Nalix Generated TypeScript Codecs & Examples

This package contains TypeScript classes and binary Little-Endian codecs generated automatically by **NXProto** (`NXProto.Engine.Generators.TypeScript.TypeScriptGenerator`) from C# packet contracts.

## Overview

- **Wire Layout:** Nalix v14 6-byte Little-Endian binary header + payload.
- **Pure Web APIs:** Built on standard `Uint8Array`, `ArrayBuffer`, and `DataView` with zero runtime dependencies.
- **Compatible with:** Web Browsers, Node.js (22+), Deno, Bun, and `@ppnsys/nalix-sdk` (`NalixClient` / `WebSocketSession`).

## Running Verification Tests

```bash
npm install
npm test
```
