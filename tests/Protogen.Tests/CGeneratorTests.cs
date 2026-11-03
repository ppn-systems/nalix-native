// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Protogen.Core.Models;
using Protogen.Engine.Generators.C;
using Xunit;

namespace Protogen.Tests;

public sealed class CGeneratorTests
{
    private readonly CGenerator _generator = new();

    [Fact]
    public void Generate_ProducesExpectedFiles()
    {
        PacketSchema packet = new(
            Name: "TestMessage",
            FullName: "Protocol.TestMessage",
            OpCode: 0x0100,
            Fields:
            [
                new FieldSchema("FieldA", "int", "int32_t", "i32", 0, false, 4, false, false, null)
            ],
            IsFixedSize: true,
            FixedSize: 4);

        IReadOnlyList<GeneratedFile> files = _generator.Generate([packet]);

        Assert.Equal(3, files.Count);
        Assert.Contains(files, f => f.FileName == "packets.h");
        Assert.Contains(files, f => f.FileName == "packets.c");
        Assert.Contains(files, f => f.FileName == "packet_test.c");
    }

    [Fact]
    public void Generate_HeaderContainsCppExternGuardAndPragmaPack()
    {
        PacketSchema packet = new(
            Name: "Sample",
            FullName: "Protocol.Sample",
            OpCode: 0x0101,
            Fields:
            [
                new FieldSchema("Value", "uint", "uint32_t", "u32", 0, false, 4, false, false, null)
            ],
            IsFixedSize: true,
            FixedSize: 4);

        IReadOnlyList<GeneratedFile> files = _generator.Generate([packet]);
        GeneratedFile header = files.First(f => f.FileName == "packets.h");

        Assert.Contains("#ifdef __cplusplus", header.Content, StringComparison.Ordinal);
        Assert.Contains("extern \"C\" {", header.Content, StringComparison.Ordinal);
        Assert.Contains("#pragma pack(push, 1)", header.Content, StringComparison.Ordinal);
        Assert.Contains("#pragma pack(pop)", header.Content, StringComparison.Ordinal);
    }
}
