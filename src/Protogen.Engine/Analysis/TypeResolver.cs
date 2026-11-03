// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.CodeAnalysis;
using Protogen.Core.Constants;

namespace Protogen.Engine.Analysis;

/// <summary>
/// Domain service that maps C# types to native unmanaged C/Rust types and wire sizes.
/// </summary>
public static class TypeResolver
{
    public static string ToCType(ITypeSymbol type)
    {
        ArgumentNullException.ThrowIfNull(type);

        string display = type.ToDisplayString();
        string name = type.Name;

        if (display == ProtocolConstants.Bytes32FullName || name == "Bytes32") return "Bytes32";
        if (name == "Bytes16") return "Bytes16";
        if (name == "Bytes64") return "Bytes64";
        if (name == "Guid" || display == "System.Guid") return "Guid";
        if (name == "Decimal" || type.SpecialType == SpecialType.System_Decimal) return "Decimal";
        if (name is "DateTime" or "TimeSpan") return "int64_t";
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

        if (type is IArrayTypeSymbol arr && arr.ElementType.SpecialType == SpecialType.System_Byte)
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

        string display = type.ToDisplayString();
        string name = type.Name;

        if (display == ProtocolConstants.Bytes32FullName || name == "Bytes32") return "[u8; 32]";
        if (name == "Bytes16" || name == "Guid" || display == "System.Guid") return "[u8; 16]";
        if (name == "Bytes64") return "[u8; 64]";
        if (name == "Decimal" || type.SpecialType == SpecialType.System_Decimal) return "[u8; 16]";
        if (name is "DateTime" or "TimeSpan") return "i64";
        if (name == "DateTimeOffset") return "[u8; 16]";
        if (name == "Half") return "u16";
        if (name == "Int128") return "i128";
        if (name == "UInt128") return "u128";

        if (type.SpecialType == SpecialType.System_String) return "Vec<u8>";
        if (type is IArrayTypeSymbol arr && arr.ElementType.SpecialType == SpecialType.System_Byte) return "Vec<u8>";
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

        string display = type.ToDisplayString();
        string name = type.Name;

        if (display == ProtocolConstants.Bytes32FullName || name == "Bytes32") return 32;
        if (name == "Bytes16" || name == "Guid" || display == "System.Guid") return 16;
        if (name == "Bytes64") return 64;
        if (name == "Decimal" || type.SpecialType == SpecialType.System_Decimal) return 16;
        if (name is "DateTime" or "TimeSpan") return 8;
        if (name == "DateTimeOffset") return 16;
        if (name == "Half") return 2;
        if (name is "Int128" or "UInt128") return 16;

        if (type.SpecialType == SpecialType.System_String) return 0; // variable-size
        if (type is IArrayTypeSymbol arr && arr.ElementType.SpecialType == SpecialType.System_Byte) return 0; // variable-size
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

        string fullName = t.FullName ?? t.Name;
        string name = t.Name;

        if (fullName == ProtocolConstants.Bytes32FullName || name == "Bytes32") return "Bytes32";
        if (name == "Bytes16") return "Bytes16";
        if (name == "Bytes64") return "Bytes64";
        if (name == "Guid" || t == typeof(Guid)) return "Guid";
        if (name == "Decimal" || t == typeof(decimal)) return "Decimal";
        if (name is "DateTime" or "TimeSpan" || t == typeof(DateTime) || t == typeof(TimeSpan)) return "int64_t";
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

        if (t == typeof(string) || name == "String" || t == typeof(byte[]) || name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal))
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

        string fullName = t.FullName ?? t.Name;
        string name = t.Name;

        if (fullName == ProtocolConstants.Bytes32FullName || name == "Bytes32") return "[u8; 32]";
        if (name == "Bytes16" || name == "Guid" || t == typeof(Guid)) return "[u8; 16]";
        if (name == "Bytes64") return "[u8; 64]";
        if (name == "Decimal" || t == typeof(decimal)) return "[u8; 16]";
        if (name is "DateTime" or "TimeSpan" || t == typeof(DateTime) || t == typeof(TimeSpan)) return "i64";
        if (name == "DateTimeOffset" || t == typeof(DateTimeOffset)) return "[u8; 16]";
        if (name == "Half") return "u16";
        if (name == "Int128") return "i128";
        if (name == "UInt128") return "u128";
        if (t == typeof(char) || name == "Char") return "u16";

        if (t == typeof(string) || name == "String" || t == typeof(byte[]) || name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal))
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

        string fullName = t.FullName ?? t.Name;
        string name = t.Name;

        if (fullName == ProtocolConstants.Bytes32FullName || name == "Bytes32") return 32;
        if (name == "Bytes16" || name == "Guid" || t == typeof(Guid)) return 16;
        if (name == "Bytes64") return 64;
        if (name == "Decimal" || t == typeof(decimal)) return 16;
        if (name is "DateTime" or "TimeSpan" || t == typeof(DateTime) || t == typeof(TimeSpan)) return 8;
        if (name == "DateTimeOffset" || t == typeof(DateTimeOffset)) return 16;
        if (name == "Half") return 2;
        if (name is "Int128" or "UInt128") return 16;
        if (t == typeof(bool) || name == "Boolean") return 1;
        if (t == typeof(char) || name == "Char") return 2;

        if (t == typeof(string) || name == "String" || t == typeof(byte[]) || name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) || name.StartsWith("Memory", StringComparison.Ordinal))
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
}
