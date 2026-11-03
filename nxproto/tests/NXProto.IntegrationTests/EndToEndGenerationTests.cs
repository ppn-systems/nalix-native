// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Contracts;
using NXProto.Core.Models;
using NXProto.Engine.Generators;
using Xunit;

namespace NXProto.IntegrationTests;

public sealed class EndToEndGenerationTests : IDisposable
{
    private readonly string _tempDir;

    public EndToEndGenerationTests()
    {
        this._tempDir = Path.Combine(Path.GetTempPath(), "nxproto_integration_" + Guid.NewGuid().ToString("N"));
        _ = Directory.CreateDirectory(this._tempDir);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(this._tempDir))
            {
                Directory.Delete(this._tempDir, true);
            }
        }
#pragma warning disable CA1031 // Do not catch general exception types
        catch (Exception)
#pragma warning restore CA1031
        {
            // Best effort cleanup
        }
    }

    [Fact]
    public async Task GeneratorFactory_GeneratesAllTargetBindingsEndToEnd()
    {
        // 1. Arrange mock packet schemas
        FieldSchema[] controlFields =
        [
            new("Header", "PacketHeader", "PacketHeader", "PacketHeader", 0, true, 6, true, false, "Nalix v14 header"),
            new("CommandId", "byte", "uint8_t", "u8", 1, false, 1, true, false, "Command identifier"),
            new("TargetSession", "ushort", "uint16_t", "u16", 2, false, 2, true, false, "Session target"),
        ];

        FieldSchema[] sessionInitFields =
        [
            new("Header", "PacketHeader", "PacketHeader", "PacketHeader", 0, true, 6, true, false, "Nalix v14 header"),
            new("PublicKey", "Bytes32", "Bytes32", "Bytes32", 1, false, 32, true, false, "Client X25519 public key"),
            new("Nonce", "Bytes32", "Bytes32", "Bytes32", 2, false, 32, true, false, "Client cryptographic nonce"),
        ];

        PacketSchema[] packets =
        [
            new("Control", "Nalix.Contracts.Control", 0x0001, controlFields, true, 9),
            new("SessionInit", "Nalix.Contracts.SessionInit", 0x0000, sessionInitFields, true, 70),
        ];

        GeneratorFactory factory = new();

        // 2. Act - Generate C
        string cOutDir = Path.Combine(this._tempDir, "c");
        ICodeGenerator? cGen = factory.GetGenerator("c");
        Assert.NotNull(cGen);
        IReadOnlyList<GeneratedFile> cFiles = cGen.Generate(packets);
        foreach (GeneratedFile file in cFiles)
        {
            string outPath = Path.Combine(cOutDir, file.RelativePath, file.FileName);
            _ = Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            await File.WriteAllTextAsync(outPath, file.Content);
        }

        // 3. Act - Generate Rust
        string rustOutDir = Path.Combine(this._tempDir, "rust");
        ICodeGenerator? rustGen = factory.GetGenerator("rust");
        Assert.NotNull(rustGen);
        IReadOnlyList<GeneratedFile> rustFiles = rustGen.Generate(packets);
        foreach (GeneratedFile file in rustFiles)
        {
            string outPath = Path.Combine(rustOutDir, file.RelativePath, file.FileName);
            _ = Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            await File.WriteAllTextAsync(outPath, file.Content);
        }

        // 4. Act - Generate TypeScript
        string tsOutDir = Path.Combine(this._tempDir, "ts");
        ICodeGenerator? tsGen = factory.GetGenerator("ts");
        Assert.NotNull(tsGen);
        IReadOnlyList<GeneratedFile> tsFiles = tsGen.Generate(packets);
        foreach (GeneratedFile file in tsFiles)
        {
            string outPath = Path.Combine(tsOutDir, file.RelativePath, file.FileName);
            _ = Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            await File.WriteAllTextAsync(outPath, file.Content);
        }

        // 5. Assert C files
        string cHeader = await File.ReadAllTextAsync(Path.Combine(cOutDir, "include", "packets.h"));
        Assert.Contains("PACKET_CONTROL_OPCODE 0x0001U", cHeader, StringComparison.Ordinal);
        Assert.Contains("PACKET_SESSIONINIT_OPCODE 0x0000U", cHeader, StringComparison.Ordinal);
        Assert.Contains("} Control;", cHeader, StringComparison.Ordinal);
        Assert.Contains("control_serialize", cHeader, StringComparison.Ordinal);

        // 6. Assert Rust files
        string rustFile = await File.ReadAllTextAsync(Path.Combine(rustOutDir, "src", "packets.rs"));
        Assert.Contains("pub const OPCODE: u16 = 0x0001;", rustFile, StringComparison.Ordinal);
        Assert.Contains("pub struct Control", rustFile, StringComparison.Ordinal);
        Assert.Contains("impl Control", rustFile, StringComparison.Ordinal);

        // 7. Assert TypeScript files
        string tsFile = await File.ReadAllTextAsync(Path.Combine(tsOutDir, "src", "packets.ts"));
        Assert.Contains("public static readonly OPCODE: number = 0x0001;", tsFile, StringComparison.Ordinal);
        Assert.Contains("export class Control", tsFile, StringComparison.Ordinal);
        Assert.Contains("public encode(): Uint8Array", tsFile, StringComparison.Ordinal);
        Assert.Contains("public static decode(raw: Uint8Array | ArrayBuffer): Control", tsFile, StringComparison.Ordinal);
    }
}
