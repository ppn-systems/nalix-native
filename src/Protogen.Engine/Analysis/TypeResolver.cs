// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.CodeAnalysis;
using Protogen.Core.Constants;

namespace Protogen.Engine.Analysis;

/// <summary>
/// Domain service that maps C# types to native unmanaged C/Rust types and wire sizes.
/// Supports primitives, unmanaged structs, collections, arrays, and nullable types.
/// </summary>
public static class TypeResolver
{
    public static string ToCType(ITypeSymbol type)
    {
        ArgumentNullException.ThrowIfNull(type);

        if (TryGetCollectionElementType(type, out ITypeSymbol? elem))
        {
            return ToCollectionCType(elem!);
        }

        string display = type.ToDisplayString();
        string name = type.Name;

        if (display == ProtocolConstants.Bytes32FullName || name == "Bytes32") return "Bytes32";
        if (name == "Bytes16") return "Bytes16";
        if (name == "Bytes64") return "Bytes64";
        if (name == "Guid" || display == "System.Guid") return "Guid";
        if (name == "Decimal" || type.SpecialType == SpecialType.System_Decimal) return "Decimal";
        if (name is "DateTime" or "TimeSpan" or "TimeOnly") return "int64_t";
        if (name == "DateOnly") return "int32_t";
        if (name == "DateTimeOffset") return "DateTimeOffset";
        if (name == "Half") return "uint16_t";
        if (name == "Int128") return "int128_t";
        if (name == "UInt128") return "uint128_t";

        if (type.TypeKind == TypeKind.Enum && type is INamedTypeSymbol namedEnum)
        {
            SpecialType underlying = namedEnum.EnumUnderlyingType?.SpecialType ?? SpecialType.System_Int32;
            return underlying switch
            {
                SpecialType.System_Byte => "uint8_t",
                SpecialType.System_SByte => "int8_t",
                SpecialType.System_Int16 => "int16_t",
                SpecialType.System_UInt16 => "uint16_t",
                SpecialType.System_Int32 => "int32_t",
                SpecialType.System_UInt32 => "uint32_t",
                SpecialType.System_Int64 => "int64_t",
                SpecialType.System_UInt64 => "uint64_t",
                _ => "int32_t"
            };
        }

        if (type.SpecialType == SpecialType.System_String)
        {
            return ProtocolConstants.StringCType;
        }

        if (name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal))
        {
            return ProtocolConstants.StringCType;
        }

        return type.SpecialType switch
        {
            SpecialType.System_Byte => "uint8_t",
            SpecialType.System_SByte => "int8_t",
            SpecialType.System_Boolean => "uint8_t",
            SpecialType.System_Char => "uint16_t",
            SpecialType.System_Int16 => "int16_t",
            SpecialType.System_UInt16 => "uint16_t",
            SpecialType.System_Int32 => "int32_t",
            SpecialType.System_UInt32 => "uint32_t",
            SpecialType.System_Int64 => "int64_t",
            SpecialType.System_UInt64 => "uint64_t",
            SpecialType.System_Single => "float",
            SpecialType.System_Double => "double",
            SpecialType.System_Decimal => "Decimal",
            _ => name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal)
                ? ProtocolConstants.PacketHeaderName
                : "uint8_t"
        };
    }

    public static string ToRustType(ITypeSymbol type)
    {
        ArgumentNullException.ThrowIfNull(type);

        if (TryGetCollectionElementType(type, out ITypeSymbol? elem))
        {
            return ToCollectionRustType(elem!);
        }

        string display = type.ToDisplayString();
        string name = type.Name;

        if (display == ProtocolConstants.Bytes32FullName || name == "Bytes32") return "[u8; 32]";
        if (name == "Bytes16" || name == "Guid" || display == "System.Guid") return "[u8; 16]";
        if (name == "Bytes64") return "[u8; 64]";
        if (name == "Decimal" || type.SpecialType == SpecialType.System_Decimal) return "[u8; 16]";
        if (name is "DateTime" or "TimeSpan" or "TimeOnly") return "i64";
        if (name == "DateOnly") return "i32";
        if (name == "DateTimeOffset") return "[u8; 16]";
        if (name == "Half") return "u16";
        if (name == "Int128") return "i128";
        if (name == "UInt128") return "u128";

        if (type.SpecialType == SpecialType.System_String) return "Vec<u8>";
        if (name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal)) return "Vec<u8>";

        if (name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal))
        {
            return ProtocolConstants.PacketHeaderName;
        }

        if (type.TypeKind == TypeKind.Enum && type is INamedTypeSymbol namedEnum)
        {
            SpecialType underlying = namedEnum.EnumUnderlyingType?.SpecialType ?? SpecialType.System_Int32;
            return underlying switch
            {
                SpecialType.System_Byte => "u8",
                SpecialType.System_SByte => "i8",
                SpecialType.System_Int16 => "i16",
                SpecialType.System_UInt16 => "u16",
                SpecialType.System_Int32 => "i32",
                SpecialType.System_UInt32 => "u32",
                SpecialType.System_Int64 => "i64",
                SpecialType.System_UInt64 => "u64",
                _ => "i32"
            };
        }

        return type.SpecialType switch
        {
            SpecialType.System_Byte => "u8",
            SpecialType.System_SByte => "i8",
            SpecialType.System_Boolean => "u8",
            SpecialType.System_Char => "u16",
            SpecialType.System_Int16 => "i16",
            SpecialType.System_UInt16 => "u16",
            SpecialType.System_Int32 => "i32",
            SpecialType.System_UInt32 => "u32",
            SpecialType.System_Int64 => "i64",
            SpecialType.System_UInt64 => "u64",
            SpecialType.System_Single => "f32",
            SpecialType.System_Double => "f64",
            SpecialType.System_Decimal => "[u8; 16]",
            _ => "u8"
        };
    }

    public static int GetTypeSize(ITypeSymbol type)
    {
        ArgumentNullException.ThrowIfNull(type);

        if (TryGetCollectionElementType(type, out _))
        {
            return 0; // Collections are variable-size
        }

        string display = type.ToDisplayString();
        string name = type.Name;

        if (display == ProtocolConstants.Bytes32FullName || name == "Bytes32") return 32;
        if (name == "Bytes16" || name == "Guid" || display == "System.Guid") return 16;
        if (name == "Bytes64") return 64;
        if (name == "Decimal" || type.SpecialType == SpecialType.System_Decimal) return 16;
        if (name is "DateTime" or "TimeSpan" or "TimeOnly") return 8;
        if (name == "DateOnly") return 4;
        if (name == "DateTimeOffset") return 16;
        if (name == "Half") return 2;
        if (name is "Int128" or "UInt128") return 16;

        if (type.SpecialType == SpecialType.System_String) return 0;
        if (name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal)) return 0;

        if (name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal))
        {
            return ProtocolConstants.PacketHeaderSize;
        }

        if (type.TypeKind == TypeKind.Enum && type is INamedTypeSymbol namedEnum)
        {
            SpecialType underlying = namedEnum.EnumUnderlyingType?.SpecialType ?? SpecialType.System_Int32;
            return underlying switch
            {
                SpecialType.System_Byte or SpecialType.System_SByte => 1,
                SpecialType.System_Int16 or SpecialType.System_UInt16 => 2,
                SpecialType.System_Int32 or SpecialType.System_UInt32 => 4,
                SpecialType.System_Int64 or SpecialType.System_UInt64 => 8,
                _ => 4
            };
        }

        return type.SpecialType switch
        {
            SpecialType.System_Byte or SpecialType.System_SByte => 1,
            SpecialType.System_Boolean => 1,
            SpecialType.System_Char => 2,
            SpecialType.System_Int16 or SpecialType.System_UInt16 => 2,
            SpecialType.System_Int32 or SpecialType.System_UInt32 => 4,
            SpecialType.System_Int64 or SpecialType.System_UInt64 => 8,
            SpecialType.System_Single => 4,
            SpecialType.System_Double => 8,
            SpecialType.System_Decimal => 16,
            _ => 1
        };
    }

    public static string ToCTypeFromReflection(Type t)
    {
        ArgumentNullException.ThrowIfNull(t);

        if (TryGetCollectionElementTypeFromReflection(t, out Type? elem))
        {
            return ToCollectionCTypeFromReflection(elem!);
        }

        string fullName = t.FullName ?? t.Name;
        string name = t.Name;

        if (fullName == ProtocolConstants.Bytes32FullName || name == "Bytes32") return "Bytes32";
        if (name == "Bytes16") return "Bytes16";
        if (name == "Bytes64") return "Bytes64";
        if (name == "Guid" || t == typeof(Guid)) return "Guid";
        if (name == "Decimal" || t == typeof(decimal)) return "Decimal";
        if (name is "DateTime" or "TimeSpan" or "TimeOnly" || t == typeof(DateTime) || t == typeof(TimeSpan)) return "int64_t";
        if (name == "DateOnly") return "int32_t";
        if (name == "DateTimeOffset" || t == typeof(DateTimeOffset)) return "DateTimeOffset";
        if (name == "Half") return "uint16_t";
        if (name == "Int128") return "int128_t";
        if (name == "UInt128") return "uint128_t";
        if (t == typeof(char) || name == "Char") return "uint16_t";

        if (t.IsEnum)
        {
            Type underlying = Enum.GetUnderlyingType(t);
            return underlying switch
            {
                Type u when u == typeof(byte) => "uint8_t",
                Type u when u == typeof(sbyte) => "int8_t",
                Type u when u == typeof(short) => "int16_t",
                Type u when u == typeof(ushort) => "uint16_t",
                Type u when u == typeof(int) => "int32_t",
                Type u when u == typeof(uint) => "uint32_t",
                Type u when u == typeof(long) => "int64_t",
                Type u when u == typeof(ulong) => "uint64_t",
                _ => "int32_t"
            };
        }

        if (t == typeof(string) || name == "String" || name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal))
        {
            return ProtocolConstants.StringCType;
        }

        return name switch
        {
            "Byte" => "uint8_t",
            "SByte" => "int8_t",
            "Int16" => "int16_t",
            "UInt16" => "uint16_t",
            "Int32" => "int32_t",
            "UInt32" => "uint32_t",
            "Int64" => "int64_t",
            "UInt64" => "uint64_t",
            "Single" => "float",
            "Double" => "double",
            "Boolean" => "uint8_t",
            _ => name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal)
                ? ProtocolConstants.PacketHeaderName
                : "uint8_t"
        };
    }

    public static string ToRustTypeFromReflection(Type t)
    {
        ArgumentNullException.ThrowIfNull(t);

        if (TryGetCollectionElementTypeFromReflection(t, out Type? elem))
        {
            return ToCollectionRustTypeFromReflection(elem!);
        }

        string fullName = t.FullName ?? t.Name;
        string name = t.Name;

        if (fullName == ProtocolConstants.Bytes32FullName || name == "Bytes32") return "[u8; 32]";
        if (name == "Bytes16" || name == "Guid" || t == typeof(Guid)) return "[u8; 16]";
        if (name == "Bytes64") return "[u8; 64]";
        if (name == "Decimal" || t == typeof(decimal)) return "[u8; 16]";
        if (name is "DateTime" or "TimeSpan" or "TimeOnly" || t == typeof(DateTime) || t == typeof(TimeSpan)) return "i64";
        if (name == "DateOnly") return "i32";
        if (name == "DateTimeOffset" || t == typeof(DateTimeOffset)) return "[u8; 16]";
        if (name == "Half") return "u16";
        if (name == "Int128") return "i128";
        if (name == "UInt128") return "u128";
        if (t == typeof(char) || name == "Char") return "u16";

        if (t == typeof(string) || name == "String" || name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal))
        {
            return "Vec<u8>";
        }

        if (name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal))
        {
            return ProtocolConstants.PacketHeaderName;
        }

        if (t.IsEnum)
        {
            Type underlying = Enum.GetUnderlyingType(t);
            return underlying switch
            {
                Type u when u == typeof(byte) => "u8",
                Type u when u == typeof(sbyte) => "i8",
                Type u when u == typeof(short) => "i16",
                Type u when u == typeof(ushort) => "u16",
                Type u when u == typeof(int) => "i32",
                Type u when u == typeof(uint) => "u32",
                Type u when u == typeof(long) => "i64",
                Type u when u == typeof(ulong) => "u64",
                _ => "i32"
            };
        }

        return name switch
        {
            "Byte" => "u8",
            "SByte" => "i8",
            "Int16" => "i16",
            "UInt16" => "u16",
            "Int32" => "i32",
            "UInt32" => "u32",
            "Int64" => "i64",
            "UInt64" => "u64",
            "Single" => "f32",
            "Double" => "f64",
            "Boolean" => "u8",
            _ => "u8"
        };
    }

    public static int GetTypeSizeFromReflection(Type t)
    {
        ArgumentNullException.ThrowIfNull(t);

        if (TryGetCollectionElementTypeFromReflection(t, out _))
        {
            return 0; // Collections are variable-size
        }

        string fullName = t.FullName ?? t.Name;
        string name = t.Name;

        if (fullName == ProtocolConstants.Bytes32FullName || name == "Bytes32") return 32;
        if (name == "Bytes16" || name == "Guid" || t == typeof(Guid)) return 16;
        if (name == "Bytes64") return 64;
        if (name == "Decimal" || t == typeof(decimal)) return 16;
        if (name is "DateTime" or "TimeSpan" or "TimeOnly" || t == typeof(DateTime) || t == typeof(TimeSpan)) return 8;
        if (name == "DateOnly") return 4;
        if (name == "DateTimeOffset" || t == typeof(DateTimeOffset)) return 16;
        if (name == "Half") return 2;
        if (name is "Int128" or "UInt128") return 16;
        if (t == typeof(bool) || name == "Boolean") return 1;
        if (t == typeof(char) || name == "Char") return 2;

        if (t == typeof(string) || name == "String" || name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal))
        {
            return 0;
        }

        if (name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal))
        {
            return ProtocolConstants.PacketHeaderSize;
        }

        if (t.IsEnum) return Marshal.SizeOf(Enum.GetUnderlyingType(t));

        try
        {
            return Marshal.SizeOf(t);
        }
#pragma warning disable CA1031
        catch
#pragma warning restore CA1031
        {
            return 1;
        }
    }

    private static bool TryGetCollectionElementType(ITypeSymbol type, out ITypeSymbol? elementType)
    {
        if (type is IArrayTypeSymbol arr)
        {
            elementType = arr.ElementType;
            return true;
        }

        if (type is INamedTypeSymbol named && named.IsGenericType && named.TypeArguments.Length == 1)
        {
            string name = named.Name;
            if (name is "List" or "HashSet" or "Queue" or "Stack" or "ReadOnlyCollection" or "IList" or "IReadOnlyList" or "ICollection" or "IEnumerable")
            {
                elementType = named.TypeArguments[0];
                return true;
            }
        }

        elementType = null;
        return false;
    }

    private static string ToCollectionCType(ITypeSymbol elem)
    {
        if (elem.SpecialType == SpecialType.System_Byte) return ProtocolConstants.StringCType;
        if (elem.SpecialType == SpecialType.System_String) return "StringArray";
        if (elem.SpecialType == SpecialType.System_Int32) return "Int32Array";
        if (elem.SpecialType == SpecialType.System_UInt32) return "UInt32Array";
        if (elem.SpecialType == SpecialType.System_Int16) return "Int16Array";
        if (elem.SpecialType == SpecialType.System_UInt16) return "UInt16Array";
        if (elem.SpecialType == SpecialType.System_Int64) return "Int64Array";
        if (elem.SpecialType == SpecialType.System_UInt64) return "UInt64Array";
        if (elem.SpecialType == SpecialType.System_Single) return "FloatArray";
        if (elem.SpecialType == SpecialType.System_Double) return "DoubleArray";
        if (elem.SpecialType == SpecialType.System_SByte) return "Int8Array";
        if (elem.SpecialType == SpecialType.System_Boolean) return "ByteArray";
        if (elem.SpecialType == SpecialType.System_Char) return "UInt16Array";

        if (elem.TypeKind == TypeKind.Enum && elem is INamedTypeSymbol namedEnum)
        {
            SpecialType underlying = namedEnum.EnumUnderlyingType?.SpecialType ?? SpecialType.System_Int32;
            return underlying switch
            {
                SpecialType.System_Byte => "ByteArray",
                SpecialType.System_SByte => "Int8Array",
                SpecialType.System_Int16 => "Int16Array",
                SpecialType.System_UInt16 => "UInt16Array",
                SpecialType.System_Int32 => "Int32Array",
                SpecialType.System_UInt32 => "UInt32Array",
                SpecialType.System_Int64 => "Int64Array",
                SpecialType.System_UInt64 => "UInt64Array",
                _ => "Int32Array"
            };
        }

        return "ByteArray";
    }

    private static string ToCollectionRustType(ITypeSymbol elem)
    {
        if (elem.SpecialType == SpecialType.System_Byte) return "Vec<u8>";
        if (elem.SpecialType == SpecialType.System_String) return "Vec<Vec<u8>>";
        if (elem.SpecialType == SpecialType.System_Int32) return "Vec<i32>";
        if (elem.SpecialType == SpecialType.System_UInt32) return "Vec<u32>";
        if (elem.SpecialType == SpecialType.System_Int16) return "Vec<i16>";
        if (elem.SpecialType == SpecialType.System_UInt16) return "Vec<u16>";
        if (elem.SpecialType == SpecialType.System_Int64) return "Vec<i64>";
        if (elem.SpecialType == SpecialType.System_UInt64) return "Vec<u64>";
        if (elem.SpecialType == SpecialType.System_Single) return "Vec<f32>";
        if (elem.SpecialType == SpecialType.System_Double) return "Vec<f64>";
        if (elem.SpecialType == SpecialType.System_SByte) return "Vec<i8>";
        if (elem.SpecialType == SpecialType.System_Boolean) return "Vec<u8>";
        if (elem.SpecialType == SpecialType.System_Char) return "Vec<u16>";

        if (elem.TypeKind == TypeKind.Enum && elem is INamedTypeSymbol namedEnum)
        {
            SpecialType underlying = namedEnum.EnumUnderlyingType?.SpecialType ?? SpecialType.System_Int32;
            return underlying switch
            {
                SpecialType.System_Byte => "Vec<u8>",
                SpecialType.System_SByte => "Vec<i8>",
                SpecialType.System_Int16 => "Vec<i16>",
                SpecialType.System_UInt16 => "Vec<u16>",
                SpecialType.System_Int32 => "Vec<i32>",
                SpecialType.System_UInt32 => "Vec<u32>",
                SpecialType.System_Int64 => "Vec<i64>",
                SpecialType.System_UInt64 => "Vec<u64>",
                _ => "Vec<i32>"
            };
        }

        return "Vec<u8>";
    }

    private static bool TryGetCollectionElementTypeFromReflection(Type t, out Type? elementType)
    {
        if (t.IsArray)
        {
            elementType = t.GetElementType();
            return elementType != null;
        }

        if (t.IsGenericType && t.GetGenericArguments().Length == 1)
        {
            string name = t.Name;
            int backtick = name.IndexOf('`', StringComparison.Ordinal);
            if (backtick > 0) name = name.Substring(0, backtick);
            if (name is "List" or "HashSet" or "Queue" or "Stack" or "ReadOnlyCollection" or "IList" or "IReadOnlyList" or "ICollection" or "IEnumerable")
            {
                elementType = t.GetGenericArguments()[0];
                return true;
            }
        }

        elementType = null;
        return false;
    }

    private static string ToCollectionCTypeFromReflection(Type elem)
    {
        string name = elem.Name;
        if (elem == typeof(byte) || name == "Byte") return ProtocolConstants.StringCType;
        if (elem == typeof(string) || name == "String") return "StringArray";
        if (elem == typeof(int) || name == "Int32") return "Int32Array";
        if (elem == typeof(uint) || name == "UInt32") return "UInt32Array";
        if (elem == typeof(short) || name == "Int16") return "Int16Array";
        if (elem == typeof(ushort) || name == "UInt16") return "UInt16Array";
        if (elem == typeof(long) || name == "Int64") return "Int64Array";
        if (elem == typeof(ulong) || name == "UInt64") return "UInt64Array";
        if (elem == typeof(float) || name == "Single") return "FloatArray";
        if (elem == typeof(double) || name == "Double") return "DoubleArray";
        if (elem == typeof(sbyte) || name == "SByte") return "Int8Array";
        if (elem == typeof(bool) || name == "Boolean") return "ByteArray";
        if (elem == typeof(char) || name == "Char") return "UInt16Array";

        if (elem.IsEnum)
        {
            Type underlying = Enum.GetUnderlyingType(elem);
            return underlying switch
            {
                Type u when u == typeof(byte) => "ByteArray",
                Type u when u == typeof(sbyte) => "Int8Array",
                Type u when u == typeof(short) => "Int16Array",
                Type u when u == typeof(ushort) => "UInt16Array",
                Type u when u == typeof(int) => "Int32Array",
                Type u when u == typeof(uint) => "UInt32Array",
                Type u when u == typeof(long) => "Int64Array",
                Type u when u == typeof(ulong) => "UInt64Array",
                _ => "Int32Array"
            };
        }

        return "ByteArray";
    }

    private static string ToCollectionRustTypeFromReflection(Type elem)
    {
        string name = elem.Name;
        if (elem == typeof(byte) || name == "Byte") return "Vec<u8>";
        if (elem == typeof(string) || name == "String") return "Vec<Vec<u8>>";
        if (elem == typeof(int) || name == "Int32") return "Vec<i32>";
        if (elem == typeof(uint) || name == "UInt32") return "Vec<u32>";
        if (elem == typeof(short) || name == "Int16") return "Vec<i16>";
        if (elem == typeof(ushort) || name == "UInt16") return "Vec<u16>";
        if (elem == typeof(long) || name == "Int64") return "Vec<i64>";
        if (elem == typeof(ulong) || name == "UInt64") return "Vec<u64>";
        if (elem == typeof(float) || name == "Single") return "Vec<f32>";
        if (elem == typeof(double) || name == "Double") return "Vec<f64>";
        if (elem == typeof(sbyte) || name == "SByte") return "Vec<i8>";
        if (elem == typeof(bool) || name == "Boolean") return "Vec<u8>";
        if (elem == typeof(char) || name == "Char") return "Vec<u16>";

        if (elem.IsEnum)
        {
            Type underlying = Enum.GetUnderlyingType(elem);
            return underlying switch
            {
                Type u when u == typeof(byte) => "Vec<u8>",
                Type u when u == typeof(sbyte) => "Vec<i8>",
                Type u when u == typeof(short) => "Vec<i16>",
                Type u when u == typeof(ushort) => "Vec<u16>",
                Type u when u == typeof(int) => "Vec<i32>",
                Type u when u == typeof(uint) => "Vec<u32>",
                Type u when u == typeof(long) => "Vec<i64>",
                Type u when u == typeof(ulong) => "Vec<u64>",
                _ => "Vec<i32>"
            };
        }

        return "Vec<u8>";
    }
}
