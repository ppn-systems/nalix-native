// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Protogen.Engine.Analysis;
using Xunit;

namespace Protogen.Tests;

public sealed class TypeResolverTests
{
    [Theory]
    [InlineData(typeof(byte), "uint8_t", "u8", 1)]
    [InlineData(typeof(sbyte), "int8_t", "i8", 1)]
    [InlineData(typeof(bool), "uint8_t", "u8", 1)]
    [InlineData(typeof(char), "uint16_t", "u16", 2)]
    [InlineData(typeof(short), "int16_t", "i16", 2)]
    [InlineData(typeof(ushort), "uint16_t", "u16", 2)]
    [InlineData(typeof(int), "int32_t", "i32", 4)]
    [InlineData(typeof(uint), "uint32_t", "u32", 4)]
    [InlineData(typeof(long), "int64_t", "i64", 8)]
    [InlineData(typeof(ulong), "uint64_t", "u64", 8)]
    [InlineData(typeof(float), "float", "f32", 4)]
    [InlineData(typeof(double), "double", "f64", 8)]
    [InlineData(typeof(decimal), "Decimal", "[u8; 16]", 16)]
    [InlineData(typeof(Guid), "Guid", "[u8; 16]", 16)]
    [InlineData(typeof(DateTime), "int64_t", "i64", 8)]
    [InlineData(typeof(TimeSpan), "int64_t", "i64", 8)]
    [InlineData(typeof(DateOnly), "int32_t", "i32", 4)]
    [InlineData(typeof(TimeOnly), "int64_t", "i64", 8)]
    [InlineData(typeof(Half), "uint16_t", "u16", 2)]
    [InlineData(typeof(Int128), "int128_t", "i128", 16)]
    [InlineData(typeof(UInt128), "uint128_t", "u128", 16)]
    [InlineData(typeof(string), "NalixString", "Vec<u8>", 0)]
    [InlineData(typeof(byte[]), "NalixString", "Vec<u8>", 0)]
    [InlineData(typeof(int[]), "Int32Array", "Vec<i32>", 0)]
    [InlineData(typeof(float[]), "FloatArray", "Vec<f32>", 0)]
    [InlineData(typeof(double[]), "DoubleArray", "Vec<f64>", 0)]
    [InlineData(typeof(string[]), "StringArray", "Vec<Vec<u8>>", 0)]
    [InlineData(typeof(List<int>), "Int32Array", "Vec<i32>", 0)]
    [InlineData(typeof(List<string>), "StringArray", "Vec<Vec<u8>>", 0)]
    public void ToTypeFromReflection_MapsCorrectly(Type type, string expectedC, string expectedRust, int expectedSize)
    {
        string cType = TypeResolver.ToCTypeFromReflection(type);
        string rustType = TypeResolver.ToRustTypeFromReflection(type);
        int size = TypeResolver.GetTypeSizeFromReflection(type);

        Assert.Equal(expectedC, cType);
        Assert.Equal(expectedRust, rustType);
        Assert.Equal(expectedSize, size);
    }
}
