// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Constants;
using NXProto.Core.Models;
using Xunit;

namespace NXProto.Core.Tests;

public sealed class PacketSchemaTests
{
    [Fact]
    public void CalculateWireSize_SumsFixedFieldSizesCorrectly()
    {
        FieldSchema[] fields =
        [
            new("Header", "PacketHeader", "PacketHeader", "PacketHeader", 0, true, 6, true, false, null),
            new("Id", "int", "int32_t", "i32", 1, false, 4, true, false, null),
            new("Value", "long", "int64_t", "i64", 2, false, 8, true, false, null),
        ];

        PacketSchema schema = new("TestPacket", "Nalix.TestPacket", 0x1000, fields, true, 18);

        Assert.Equal(18, schema.CalculateWireSize());
        Assert.False(schema.HasVariableFields);
    }

    [Fact]
    public void HasVariableFields_IdentifiesDynamicTypes()
    {
        FieldSchema[] fields =
        [
            new("Header", "PacketHeader", "PacketHeader", "PacketHeader", 0, true, 6, true, false, null),
            new("Message", "string", ProtocolConstants.StringCType, "String", 1, false, 0, false, false, null),
        ];

        PacketSchema schema = new("DynamicPacket", "Nalix.DynamicPacket", 0x1001, fields, false, 0);

        Assert.True(schema.HasVariableFields);
    }

    [Fact]
    public void Validate_ThrowsOnInvalidOrEmptyName()
    {
        PacketSchema schema = new("", "Invalid", 0x1002, [], true, 0);
        Assert.Throws<InvalidOperationException>(() => schema.Validate());
    }

    [Fact]
    public void Validate_ThrowsOnDuplicateFieldOrders()
    {
        FieldSchema[] fields =
        [
            new("FieldA", "int", "int32_t", "i32", 1, false, 4, true, false, null),
            new("FieldB", "int", "int32_t", "i32", 1, false, 4, true, false, null),
        ];

        PacketSchema schema = new("DuplicateOrderPacket", "Nalix.DuplicateOrderPacket", 0x1003, fields, true, 8);
        Assert.Throws<InvalidOperationException>(() => schema.Validate());
    }

    [Fact]
    public void Validate_PassesOnValidSchema()
    {
        FieldSchema[] fields =
        [
            new("Header", "PacketHeader", "PacketHeader", "PacketHeader", 0, true, 6, true, false, null),
            new("Payload", "int", "int32_t", "i32", 1, false, 4, true, false, null),
        ];

        PacketSchema schema = new("ValidPacket", "Nalix.ValidPacket", 0x1004, fields, true, 10);
        schema.Validate(); // Should not throw
    }
}
