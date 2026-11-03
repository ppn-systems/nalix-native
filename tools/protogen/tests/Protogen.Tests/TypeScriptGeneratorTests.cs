// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Protogen.Core.Models;
using Protogen.Engine.Generators.TypeScript;
using Xunit;

namespace Protogen.Tests;

public sealed class TypeScriptGeneratorTests
{
    private readonly TypeScriptGenerator _generator = new();

    [Fact]
    public void Generate_ProducesExpectedFiles()
    {
        PacketSchema packet = new(
            Name: "TestMessage",
            FullName: "Protocol.TestMessage",
            OpCode: 0x0100,
            Fields:
            [
                new FieldSchema("Type", "byte", "uint8_t", "u8", 0, false, 1, false, false, null)
            ],
            IsFixedSize: true,
            FixedSize: 1);

        IReadOnlyList<GeneratedFile> files = _generator.Generate([packet]);

        Assert.Equal(2, files.Count);
        Assert.Contains(files, f => f.FileName == "packets.ts");
        Assert.Contains(files, f => f.FileName == "packets.test.ts");
    }

    [Fact]
    public void Generate_ProducesCorrectClassAndMethods()
    {
        PacketSchema packet = new(
            Name: "SessionInit",
            FullName: "Protocol.SessionInit",
            OpCode: 0x0000,
            Fields:
            [
                new FieldSchema("Header", "PacketHeader", "PacketHeader", "PacketHeader", 0, true, 6, true, false, null),
                new FieldSchema("ClientEphemeral", "Bytes32", "Bytes32", "[u8; 32]", 1, false, 32, true, false, null)
            ],
            IsFixedSize: true,
            FixedSize: 38);

        IReadOnlyList<GeneratedFile> files = _generator.Generate([packet]);
        GeneratedFile main = files.First(f => f.FileName == "packets.ts");

        Assert.Contains("export class SessionInit", main.Content, StringComparison.Ordinal);
        Assert.Contains("public static readonly OPCODE: number = 0x0000;", main.Content, StringComparison.Ordinal);
        Assert.Contains("public static readonly FIXED_SIZE: number = 38;", main.Content, StringComparison.Ordinal);
        Assert.Contains("public clientEphemeral: Uint8Array", main.Content, StringComparison.Ordinal);
        Assert.Contains("public encode(): Uint8Array", main.Content, StringComparison.Ordinal);
        Assert.Contains("public static decode(raw: Uint8Array | ArrayBuffer): SessionInit", main.Content, StringComparison.Ordinal);
    }

    [Fact]
    public void Generate_WithVariableFields_CalculatesTotalSize()
    {
        PacketSchema packet = new(
            Name: "ChatMessage",
            FullName: "Protocol.ChatMessage",
            OpCode: 0x0200,
            Fields:
            [
                new FieldSchema("Id", "int", "int32_t", "i32", 0, false, 4, true, false, null),
                new FieldSchema("Content", "string", "NalixString", "Vec<u8>", 1, false, 0, false, false, null)
            ],
            IsFixedSize: false,
            FixedSize: 4);

        IReadOnlyList<GeneratedFile> files = _generator.Generate([packet]);
        GeneratedFile main = files.First(f => f.FileName == "packets.ts");

        Assert.Contains("let totalSize = ChatMessage.FIXED_SIZE;", main.Content, StringComparison.Ordinal);
        Assert.Contains("const contentBytes = new TextEncoder().encode(this.content);", main.Content, StringComparison.Ordinal);
        Assert.Contains("new TextDecoder().decode", main.Content, StringComparison.Ordinal);
    }
}
