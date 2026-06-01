// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using System.Reflection;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using Nalix.Protocol.Toolkit.Abstractions;

namespace Nalix.Protocol.Toolkit.Roslyn;

/// <summary>
/// Production-grade Roslyn analyzer.
/// Sử dụng KnownAttributes + typeof để loại bỏ hoàn toàn magic string.
/// Hỗ trợ đầy đủ Bytes32, PacketHeader, PacketBase<T>, SerializeOrder, SerializeHeader...
/// </summary>
public sealed class PacketAnalyzer
{
    public static async Task<IReadOnlyList<PacketDefinition>> AnalyzeAsync(
        string projectPath,
        CancellationToken ct = default)
    {
        using MSBuildWorkspace workspace = MSBuildWorkspace.Create();

        _ = workspace.RegisterWorkspaceFailedHandler(e => Console.WriteLine($"[WARN] MSBuild: {e.Diagnostic.Message}"));

        Project project = await workspace.OpenProjectAsync(projectPath, cancellationToken: ct).ConfigureAwait(false);
        Compilation compilation = await project.GetCompilationAsync(ct).ConfigureAwait(false) ?? throw new InvalidOperationException("Cannot obtain compilation from project.");

        List<PacketDefinition> packets = new();
        HashSet<string> seen = new(StringComparer.Ordinal);

        // PacketHeader is always present — hardcoded from explicit layout
        packets.Add(CreatePacketHeaderDefinition());
        seen.Add("Nalix.Abstractions.Primitives.PacketHeader");

        foreach (SyntaxTree syntaxTree in compilation.SyntaxTrees)
        {
            SemanticModel semanticModel = compilation.GetSemanticModel(syntaxTree);
            SyntaxNode root = await syntaxTree.GetRootAsync(ct).ConfigureAwait(false);

            foreach (TypeDeclarationSyntax typeDecl in root.DescendantNodes().OfType<TypeDeclarationSyntax>())
            {
                if (semanticModel.GetDeclaredSymbol(typeDecl, ct) is not INamedTypeSymbol symbol)
                {
                    continue;
                }

                if (IsPacket(symbol))
                {
                    string fullName = symbol.ToDisplayString();
                    if (!seen.Add(fullName))
                    {
                        continue;
                    }

                    PacketDefinition? definition = BuildPacketDefinition(symbol, semanticModel);
                    if (definition is not null)
                    {
                        packets.Add(definition);
                    }
                }
            }
        }

        return packets;
    }

    private static PacketDefinition CreatePacketHeaderDefinition()
    {
        // PacketHeader uses [StructLayout(Explicit)] with fixed offsets:
        //   MagicNumber: uint   @ offset 0  (4 bytes)
        //   OpCode:      ushort @ offset 4  (2 bytes)
        //   Flags:       byte   @ offset 6  (1 byte)
        //   Priority:    byte   @ offset 7  (1 byte)
        //   SequenceId:  ushort @ offset 8  (2 bytes)
        //   Total: 10 bytes
        List<PacketField> fields =
        [
            new PacketField("MagicNumber", "uint", "uint32_t", 0, true, 4, true, null),
            new PacketField("OpCode", "ushort", "uint16_t", 4, true, 2, true, null),
            new PacketField("Flags", "byte", "uint8_t", 6, true, 1, true, null),
            new PacketField("Priority", "byte", "uint8_t", 7, true, 1, true, null),
            new PacketField("SequenceId", "ushort", "uint16_t", 8, true, 2, true, null),
        ];

        return new PacketDefinition(
            Name: "PacketHeader",
            FullName: "Nalix.Abstractions.Primitives.PacketHeader",
            Magic: 0,
            Fields: fields,
            IsFixedSize: true,
            FixedSize: 10
        );
    }

    public static List<PacketDefinition> AnalyzeFromAssembly(string assemblyPath)
    {
        List<PacketDefinition> packets = new();
        packets.Add(CreatePacketHeaderDefinition());
        Assembly assembly = Assembly.LoadFrom(assemblyPath);

        foreach (Type type in assembly.GetTypes())
        {
            if (type.IsAbstract || type.IsInterface || type.IsGenericType)
            {
                continue;
            }

            if (!HasPacketAttribute(type) && type.Name != "PacketHeader")
            {
                continue;
            }

            PacketDefinition? definition = BuildPacketDefinitionFromType(type);
            if (definition != null)
            {
                packets.Add(definition);
            }
        }

        return packets;
    }

    private static PacketDefinition? BuildPacketDefinitionFromType(Type type)
    {
        List<PacketField> fields = new();

        // Lấy tất cả public properties và fields
        foreach (PropertyInfo prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            fields.Add(new PacketField(
                Name: prop.Name,
                CSharpType: prop.PropertyType.FullName ?? prop.PropertyType.Name,
                CType: ToCTypeFromReflection(prop.PropertyType),
                Order: 0,
                IsHeader: false,
                Size: GetTypeSizeFromReflection(prop.PropertyType),
                IsUnmanaged: prop.PropertyType.IsValueType,
                Comment: null
            ));
        }

        foreach (FieldInfo field in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
        {
            fields.Add(new PacketField(
                Name: field.Name,
                CSharpType: field.FieldType.FullName ?? field.FieldType.Name,
                CType: ToCTypeFromReflection(field.FieldType),
                Order: 0,
                IsHeader: false,
                Size: GetTypeSizeFromReflection(field.FieldType),
                IsUnmanaged: field.FieldType.IsValueType,
                Comment: null
            ));
        }

        uint magic = ComputeMagic(type.FullName ?? type.Name);

        return new PacketDefinition(
            Name: type.Name,
            FullName: type.FullName ?? type.Name,
            Magic: magic,
            Fields: fields,
            IsFixedSize: true,
            FixedSize: 0
        );
    }

    private static bool HasPacketAttribute(Type type)
    {
        return type.GetCustomAttributes()
                   .Any(a => a.GetType().Name == "PacketAttribute");
    }

    private static bool InheritsPacketBaseOfSelf(INamedTypeSymbol symbol)
    {
        INamedTypeSymbol? current = symbol.BaseType;
        while (current is not null)
        {
            if (current.Name == KnownTypes.PacketBaseName &&
                current.ContainingNamespace?.ToDisplayString() == KnownTypes.PacketBaseNamespace &&
                current.TypeArguments.Length == 1 &&
                SymbolEqualityComparer.Default.Equals(current.TypeArguments[0], symbol))
            {
                return true;
            }

            current = current.BaseType;
        }
        return false;
    }

    private static PacketDefinition? BuildPacketDefinition(INamedTypeSymbol symbol, SemanticModel semanticModel)
    {
        List<PacketField> fields = new();
        List<ISymbol> orderedMembers = GetOrderedMembers(symbol);

        foreach (ISymbol member in orderedMembers)
        {
            PacketField? field = BuildPacketField(member, semanticModel);
            if (field is not null)
            {
                fields.Add(field);
            }
        }

        uint magic = ComputeMagic(symbol.ToDisplayString());

        return new PacketDefinition(
            Name: symbol.Name,
            FullName: symbol.ToDisplayString(),
            Magic: magic,
            Fields: fields,
            IsFixedSize: symbol.AllInterfaces.Any(i =>
                i.ToDisplayString() == KnownTypes.IFixedSizeSerializable),
            FixedSize: 0
        );
    }

    private static List<ISymbol> GetOrderedMembers(INamedTypeSymbol symbol)
    {
        List<ISymbol> allMembers = new();
        INamedTypeSymbol? currentType = symbol;

        while (currentType != null && currentType.SpecialType == SpecialType.None)
        {
            foreach (ISymbol member in currentType.GetMembers())
            {
                if (member is not (IFieldSymbol or IPropertySymbol) || member.IsStatic)
                {
                    continue;
                }

                bool hasOrder = HasAttribute(member, KnownAttributes.SerializeOrder);
                bool hasHeader = HasAttribute(member, KnownAttributes.SerializeHeader);
                bool hasIgnore = HasAttribute(member, KnownAttributes.SerializeIgnore);

                if (hasIgnore)
                {
                    continue;
                }

                if (hasOrder || hasHeader)
                {
                    allMembers.Add(member);
                }
            }
            currentType = currentType.BaseType;
        }

        // Headers trước, sau đó là payload theo thứ tự SerializeOrder
        IOrderedEnumerable<ISymbol> headers = allMembers
            .Where(m => HasAttribute(m, KnownAttributes.SerializeHeader))
            .OrderBy(m => GetOrder(m, KnownAttributes.SerializeHeader));

        IOrderedEnumerable<ISymbol> payload = allMembers
            .Where(m => HasAttribute(m, KnownAttributes.SerializeOrder))
            .OrderBy(m => GetOrder(m, KnownAttributes.SerializeOrder));

        return [.. headers, .. payload];
    }

    private static bool HasAttribute(ISymbol member, string attributeName)
        => member.GetAttributes().Any(a => a.AttributeClass?.ToDisplayString() == attributeName);

    private static int GetOrder(ISymbol member, string attributeName)
    {
        AttributeData? attr = member.GetAttributes().FirstOrDefault(a => a.AttributeClass?.ToDisplayString() == attributeName);
        return attr?.ConstructorArguments.FirstOrDefault().Value as int? ?? 0;
    }

    private static PacketField? BuildPacketField(ISymbol member, SemanticModel semanticModel)
    {
        ITypeSymbol? typeSymbol = member switch
        {
            IFieldSymbol f => f.Type,
            IPropertySymbol p => p.Type,
            _ => null
        };

        return typeSymbol == null
            ? null
            : new PacketField(
            Name: member.Name,
            CSharpType: typeSymbol.ToDisplayString(),
            CType: ToCType(typeSymbol),
            Order: 0,
            IsHeader: HasAttribute(member, KnownAttributes.SerializeHeader),
            Size: GetTypeSize(typeSymbol),
            IsUnmanaged: typeSymbol.IsUnmanagedType,
            Comment: null
        );
    }

    private static string ToCType(ITypeSymbol type)
    {
        // Bytes32
        if (type.ToDisplayString() == "Nalix.Abstractions.Primitives.Bytes32")
        {
            return "Bytes32";
        }

        // Enum - Lấy underlying type chính xác
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

        // Primitive types
        return type.ToDisplayString() switch
        {
            "byte" or "System.Byte" => "uint8_t",
            "sbyte" or "System.SByte" => "int8_t",
            "short" or "System.Int16" => "int16_t",
            "ushort" or "System.UInt16" => "uint16_t",
            "int" or "System.Int32" => "int32_t",
            "uint" or "System.UInt32" => "uint32_t",
            "long" or "System.Int64" => "int64_t",
            "ulong" or "System.UInt64" => "uint64_t",
            "float" or "System.Single" => "float",
            "double" or "System.Double" => "double",
            "bool" or "System.Boolean" => "uint8_t",
            "string" or "System.String" => "NalixString",
            _ => $"/* unknown: {type.Name} */ uint8_t"
        };
    }

    private static int GetTypeSize(ITypeSymbol type)
    {
        if (type.ToDisplayString() == "Nalix.Abstractions.Primitives.Bytes32")
        {
            return 32;
        }

        if (type.SpecialType == SpecialType.System_String)
        {
            return 0; // variable-size
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
            _ => 4
        };
    }

    private static string ToCTypeFromReflection(Type t)
    {
        if (t.FullName == "Nalix.Abstractions.Primitives.Bytes32")
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
            "String" => "char*",           // sẽ xử lý riêng ở serialize
            _ => "uint8_t"
        };
    }

    private static int GetTypeSizeFromReflection(Type t) => t.FullName == "Nalix.Abstractions.Primitives.Bytes32" ? 32 : t.IsEnum ? 4 : System.Runtime.InteropServices.Marshal.SizeOf(t);

    private static uint ComputeMagic(string fullName)
    {
        uint hash = 2166136261u;
        foreach (char c in fullName)
        {
            hash ^= c;
            hash *= 16777619u;
        }
        return hash;
    }

    private static bool IsPacket(INamedTypeSymbol symbol)
        => symbol.GetAttributes().Any(a => a.AttributeClass?.ToDisplayString() == KnownAttributes.Packet) && InheritsPacketBaseOfSelf(symbol);
}
