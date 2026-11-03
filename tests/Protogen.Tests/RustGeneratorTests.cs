// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Protogen.Core.Models;
using Protogen.Engine.Generators.Rust;
using Xunit;

namespace Protogen.Tests;

public sealed class RustGeneratorTests
{
    private readonly RustGenerator _generator = new();

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
        Assert.Contains(files, f => f.FileName == "packets.rs");
        Assert.Contains(files, f => f.FileName == "packets_tests.rs");
    }

    [Fact]
    public void Generate_EscapesRustReservedKeywords()
    {
        PacketSchema packet = new(
            Name: "Directive",
            FullName: "Protocol.Directive",
            OpCode: 0x0102,
            Fields:
            [
                new FieldSchema("Type", "byte", "uint8_t", "u8", 0, false, 1, false, false, null),
                new FieldSchema("Match", "uint", "uint32_t", "u32", 1, false, 4, false, false, null)
            ],
            IsFixedSize: true,
            FixedSize: 5);

        IReadOnlyList<GeneratedFile> files = _generator.Generate([packet]);
        GeneratedFile module = files.First(f => f.FileName == "packets.rs");

        Assert.Contains("pub r#type: u8", module.Content, StringComparison.Ordinal);
        Assert.Contains("pub r#match: u32", module.Content, StringComparison.Ordinal);
        Assert.Contains("#[repr(C)]", module.Content, StringComparison.Ordinal);
    }
}
