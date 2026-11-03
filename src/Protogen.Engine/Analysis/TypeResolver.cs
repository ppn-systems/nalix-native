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

        if (type.ToDisplayString() == ProtocolConstants.Bytes32FullName)
        {
            return "Bytes32";
        }

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

        return type.SpecialType switch
        {
            SpecialType.System_Byte => "uint8_t",
            SpecialType.System_SByte => "int8_t",
            SpecialType.System_Boolean => "uint8_t",
            SpecialType.System_Int16 => "int16_t",
            SpecialType.System_UInt16 => "uint16_t",
            SpecialType.System_Int32 => "int32_t",
            SpecialType.System_UInt32 => "uint32_t",
            SpecialType.System_Int64 => "int64_t",
            SpecialType.System_UInt64 => "uint64_t",
            SpecialType.System_Single => "float",
            SpecialType.System_Double => "double",
            _ => type.Name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal)
                ? ProtocolConstants.PacketHeaderName
                : "uint8_t"
        };
    }

    public static string ToRustType(ITypeSymbol type)
    {
        ArgumentNullException.ThrowIfNull(type);

        if (type.ToDisplayString() == ProtocolConstants.Bytes32FullName)
        {
            return "[u8; 32]";
        }

        if (type.SpecialType == SpecialType.System_String)
        {
            return "Vec<u8>";
        }

        if (type.Name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal))
        {
            return ProtocolConstants.PacketHeaderName;
        }

        return type.SpecialType switch
        {
            SpecialType.System_Byte => "u8",
            SpecialType.System_SByte => "i8",
            SpecialType.System_Boolean => "u8",
            SpecialType.System_Int16 => "i16",
            SpecialType.System_UInt16 => "u16",
            SpecialType.System_Int32 => "i32",
            SpecialType.System_UInt32 => "u32",
            SpecialType.System_Int64 => "i64",
            SpecialType.System_UInt64 => "u64",
            SpecialType.System_Single => "f32",
            SpecialType.System_Double => "f64",
            _ => "u8"
        };
    }

    public static int GetTypeSize(ITypeSymbol type)
    {
        ArgumentNullException.ThrowIfNull(type);

        if (type.ToDisplayString() == ProtocolConstants.Bytes32FullName)
        {
            return 32;
        }

        if (type.SpecialType == SpecialType.System_String)
        {
            return 0; // variable-size
        }

        if (type.Name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal))
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
            _ => 1
        };
    }

    public static string ToCTypeFromReflection(Type t)
    {
        ArgumentNullException.ThrowIfNull(t);

        if (t.FullName == ProtocolConstants.Bytes32FullName)
        {
            return "Bytes32";
        }

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

        return t.Name switch
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
            "String" => ProtocolConstants.StringCType,
            _ => t.Name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal)
                ? ProtocolConstants.PacketHeaderName
                : "uint8_t"
        };
    }

    public static string ToRustTypeFromReflection(Type t)
    {
        ArgumentNullException.ThrowIfNull(t);

        if (t.FullName == ProtocolConstants.Bytes32FullName)
        {
            return "[u8; 32]";
        }

        if (t.Name == "String")
        {
            return "Vec<u8>";
        }

        if (t.Name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal))
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

        return t.Name switch
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

        if (t.FullName == ProtocolConstants.Bytes32FullName) return 32;
        if (t.Name == "String" || t.Name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal)) return 0;
        if (t.Name.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal)) return ProtocolConstants.PacketHeaderSize;
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
