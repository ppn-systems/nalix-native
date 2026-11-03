# Protogen Tool

Protogen is the protocol code generation engine for Nalix Native. It parses C# binary packet contracts via Roslyn compilation workspaces or reflection metadata and emits native C (C99, ESP-IDF, FreeRTOS) and Rust data structures matching the Nalix v14 wire protocol.

## Directory Structure

```plaintext
tools/protogen/
├── src/
│   ├── Protogen.Core/        # Domain models, contracts, and protocol constants
│   ├── Protogen.Engine/      # Analysis pipelines (Roslyn, Reflection) and generators (C, Rust)
│   ├── Protogen.Cli/         # Command-line interface
│   └── Protogen.slnx         # Solution file
└── tests/
    └── Protogen.Tests/       # Unit test suite
```

## Compilation

```bash
# Build the tool
dotnet build src/Protogen.slnx -c Release

# Run tests
dotnet test src/Protogen.slnx -c Release

# Publish single-file binary
dotnet publish src/Protogen.Cli/Protogen.Cli.csproj -c Release -o bin/
```
