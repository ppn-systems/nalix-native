// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Protogen.Core.Models;
using Protogen.Core.Validation;
using Xunit;

namespace Protogen.Tests;

public sealed class SchemaValidatorTests
{
    private readonly SchemaValidator _validator = new();

    [Fact]
    public void Validate_CleanPackets_ReturnsValid()
    {
        PacketSchema p1 = new(
            Name: "TestA",
            FullName: "Protocol.TestA",
            OpCode: 0x0001,
            Fields:
            [
                new FieldSchema("Field1", "int", "int32_t", "i32", 0, false, 4, false, false, "Test field")
            ],
            IsFixedSize: true,
            FixedSize: 4);

        PacketSchema p2 = new(
            Name: "TestB",
            FullName: "Protocol.TestB",
            OpCode: 0x0002,
            Fields:
            [
                new FieldSchema("Field2", "ushort", "uint16_t", "u16", 0, false, 2, false, false, "Test field")
            ],
            IsFixedSize: true,
            FixedSize: 2);

        ValidationResult result = _validator.Validate([p1, p2]);

        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Validate_DuplicateOpCode_ReturnsErrorPG001()
    {
        PacketSchema p1 = new("Alpha", "Protocol.Alpha", 0x0010, [], true, 0);
        PacketSchema p2 = new("Beta", "Protocol.Beta", 0x0010, [], true, 0);

        ValidationResult result = _validator.Validate([p1, p2]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Code == "PG001");
    }

    [Fact]
    public void Validate_DuplicateFieldOrder_ReturnsErrorPG003()
    {
        PacketSchema packet = new(
            Name: "DuplicateOrderPacket",
            FullName: "Protocol.DuplicateOrderPacket",
            OpCode: 0x0020,
            Fields:
            [
                new FieldSchema("F1", "int", "int32_t", "i32", 0, false, 4, false, false, null),
                new FieldSchema("F2", "int", "int32_t", "i32", 0, false, 4, false, false, null)
            ],
            IsFixedSize: true,
            FixedSize: 8);

        ValidationResult result = _validator.Validate([packet]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Code == "PG003");
    }

    [Fact]
    public void Validate_NameCollisionCaseInsensitive_ReturnsErrorPG005()
    {
        PacketSchema p1 = new("StatusUpdate", "Protocol.StatusUpdate", 0x0031, [], true, 0);
        PacketSchema p2 = new("statusupdate", "Protocol.statusupdate", 0x0032, [], true, 0);

        ValidationResult result = _validator.Validate([p1, p2]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Code == "PG005");
    }
}
