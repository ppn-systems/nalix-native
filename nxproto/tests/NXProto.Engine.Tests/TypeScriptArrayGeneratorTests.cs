// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Models;
using NXProto.Engine.Generators.TypeScript;
using Xunit;

namespace NXProto.Tests;

public sealed class TypeScriptArrayGeneratorTests
{
    private static string GenerateMain(params FieldSchema[] fields)
    {
        PacketSchema packet = new(
            Name: "ArrayProbe",
            FullName: "Protocol.ArrayProbe",
            OpCode: 0x0300,
            Fields: fields,
            IsFixedSize: false,
            FixedSize: 0);

        return new TypeScriptGenerator().Generate([packet]).First(f => f.FileName == "packets.ts").Content;
    }

    [Fact]
    public void GuidArray_MapsToUint8ArrayElementsWithSixteenByteWire()
    {
        string ts = GenerateMain(new FieldSchema("Ids", "System.Guid[]", "ByteArray", "Vec<u8>", 0, false, 0, false, false, null));

        Assert.Contains("public ids: Uint8Array[] = [];", ts, StringComparison.Ordinal);
        Assert.Contains("buffer.set(item, offset); offset += 16;", ts, StringComparison.Ordinal);
        Assert.Contains("view.getInt32(offset, true)", ts, StringComparison.Ordinal);
        Assert.Contains("idsArr.push(buffer.slice(offset, offset + 16));", ts, StringComparison.Ordinal);
        Assert.Contains("pkt.ids = idsArr;", ts, StringComparison.Ordinal);
    }

    [Fact]
    public void StringArray_MapsToStringArrayWithLengthPrefixedElements()
    {
        string ts = GenerateMain(new FieldSchema("Tags", "string[]", "StringArray", "Vec<Vec<u8>>", 0, false, 0, false, false, null));

        Assert.Contains("public tags: string[] = [];", ts, StringComparison.Ordinal);
        Assert.Contains("const tagsItems = this.tags.map((s) => new TextEncoder().encode(s));", ts, StringComparison.Ordinal);
        Assert.Contains("for (const item of tagsItems) {", ts, StringComparison.Ordinal);
        Assert.Contains("tagsArr.push(new TextDecoder().decode(buffer.subarray(offset, offset + itemLen)));", ts, StringComparison.Ordinal);
    }

    [Fact]
    public void NumericArrays_MapToNumberAndBigIntElementTypes()
    {
        string ts = GenerateMain(
            new FieldSchema("Scores", "int[]", "Int32Array", "Vec<i32>", 0, false, 0, false, false, null),
            new FieldSchema("Big", "long[]", "Int64Array", "Vec<i64>", 1, false, 0, false, false, null),
            new FieldSchema("Flags", "bool[]", "ByteArray", "Vec<u8>", 2, false, 0, false, false, null));

        Assert.Contains("public scores: number[] = [];", ts, StringComparison.Ordinal);
        Assert.Contains("public big: bigint[] = [];", ts, StringComparison.Ordinal);
        Assert.Contains("public flags: boolean[] = [];", ts, StringComparison.Ordinal);
        Assert.Contains("view.setInt32(offset, item, true); offset += 4;", ts, StringComparison.Ordinal);
        Assert.Contains("view.setBigInt64(offset, BigInt(item), true); offset += 8;", ts, StringComparison.Ordinal);
        Assert.Contains("flagsArr.push(view.getUint8(offset) !== 0);", ts, StringComparison.Ordinal);
    }

    [Fact]
    public void ByteArray_StaysLengthPrefixedUint8Array()
    {
        string ts = GenerateMain(new FieldSchema("Raw", "byte[]", "NalixString", "Vec<u8>", 0, false, 0, false, false, null));

        Assert.Contains("public raw: Uint8Array = new Uint8Array(0);", ts, StringComparison.Ordinal);
        Assert.Contains("view.setInt32(offset, this.raw.byteLength, true);", ts, StringComparison.Ordinal);
        Assert.Contains("pkt.raw = buffer.slice(offset, offset + rawLen);", ts, StringComparison.Ordinal);
        Assert.DoesNotContain("TextEncoder().encode(this.raw)", ts, StringComparison.Ordinal);
    }

    [Fact]
    public void GeneratedTests_UseArraySamplesAndDeepEquality()
    {
        PacketSchema packet = new(
            Name: "ArrayProbe",
            FullName: "Protocol.ArrayProbe",
            OpCode: 0x0300,
            Fields:
            [
                new FieldSchema("Ids", "System.Guid[]", "ByteArray", "Vec<u8>", 0, false, 0, false, false, null),
                new FieldSchema("Tags", "string[]", "StringArray", "Vec<Vec<u8>>", 1, false, 0, false, false, null),
            ],
            IsFixedSize: false,
            FixedSize: 0);

        string tests = new TypeScriptGenerator().Generate([packet]).First(f => f.FileName == "packets.test.ts").Content;

        Assert.Contains("pkt.ids = [new Uint8Array(16).fill(0x5a)];", tests, StringComparison.Ordinal);
        Assert.Contains("pkt.tags = ['test-string-payload'];", tests, StringComparison.Ordinal);
        Assert.Contains("assert.deepEqual(decoded.ids, pkt.ids);", tests, StringComparison.Ordinal);
        Assert.Contains("assert.deepEqual(decoded.tags, pkt.tags);", tests, StringComparison.Ordinal);
    }

    [Fact]
    public void UnsupportedArrayElement_FailsLoudlyInsteadOfEmittingWrongCode()
    {
        FieldSchema field = new("Opaque", "Nalix.Foo[]", "CustomArray", "Vec<u8>", 0, false, 0, false, false, null);

        Assert.Throws<NotSupportedException>(() => GenerateMain(field));
    }
}
