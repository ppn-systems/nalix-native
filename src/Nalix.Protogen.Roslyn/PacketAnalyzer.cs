// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using Nalix.Protogen.Abstractions;

namespace Nalix.Protogen.Roslyn;

/// <summary>
/// Production-grade Roslyn analyzer.
/// Decoupled from runtime assemblies so it can parse any Nalix contract version.
/// Supports Bytes32, Nalix v14 6-byte PacketHeader, StaticOpCode, PacketBase&lt;T&gt;, SerializeOrder, SerializeHeader...
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

        // PacketHeader is always present — hardcoded from Nalix v14 explicit layout (6 bytes)
        packets.Add(CreatePacketHeaderDefinition());
        seen.Add(KnownTypes.PacketHeader);

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
        // Nalix v14 standard PacketHeader (6 bytes):
        //   OpCode:      ushort @ offset 0  (2 bytes)
        //   Flags:       byte   @ offset 2  (1 byte)
        //   Priority:    byte   @ offset 3  (1 byte)
        //   SequenceId:  ushort @ offset 4  (2 bytes)
        //   Total: 6 bytes
        List<PacketField> fields =
        [
            new PacketField("OpCode", "ushort", "uint16_t", 0, true, 2, true, false, null),
            new PacketField("Flags", "byte", "uint8_t", 2, true, 1, true, false, null),
            new PacketField("Priority", "byte", "uint8_t", 3, true, 1, true, false, null),
            new PacketField("SequenceId", "ushort", "uint16_t", 4, true, 2, true, false, null),
        ];

        return new PacketDefinition(
            Name: "PacketHeader",
            FullName: KnownTypes.PacketHeader,
            OpCode: 0,
            Fields: fields,
            IsFixedSize: true,
            FixedSize: 6
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
        List<MemberInfo> allMembers = new();
        Type? currentType = type;

        while (currentType != null && currentType != typeof(object))
        {
            MemberInfo[] members = currentType.GetMembers(
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly);

            foreach (MemberInfo member in members)
            {
                if (member is not (FieldInfo or PropertyInfo))
                {
                    continue;
                }

                bool hasOrder = HasCustomAttribute(member, "SerializeOrder");
                bool hasHeader = HasCustomAttribute(member, "SerializeHeader");
                bool hasIgnore = HasCustomAttribute(member, "SerializeIgnore");

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

        IOrderedEnumerable<MemberInfo> headers = allMembers
            .Where(m => HasCustomAttribute(m, "SerializeHeader"))
            .OrderBy(m => GetAttributeOrder(m, "SerializeHeader"));

        IOrderedEnumerable<MemberInfo> payload = allMembers
            .Where(m => HasCustomAttribute(m, "SerializeOrder"))
            .OrderBy(m => GetAttributeOrder(m, "SerializeOrder"));

        List<PacketField> fields = new();

        foreach (MemberInfo member in headers.Concat(payload))
        {
            Type memberType = member switch
            {
                FieldInfo f => f.FieldType,
                PropertyInfo p => p.PropertyType,
                _ => typeof(object)
            };

            bool isNullable = memberType.IsGenericType && memberType.GetGenericTypeDefinition() == typeof(Nullable<>);
            Type effectiveType = isNullable ? Nullable.GetUnderlyingType(memberType)! : memberType;

            bool isHeader = HasCustomAttribute(member, "SerializeHeader");
            int order = isHeader ? GetAttributeOrder(member, "SerializeHeader") : GetAttributeOrder(member, "SerializeOrder");

            string fieldName = member.Name.TrimStart('_');
            if (fieldName.Length > 0 && char.IsLower(fieldName[0]))
            {
                fieldName = char.ToUpperInvariant(fieldName[0]) + fieldName.Substring(1);
            }

            fields.Add(new PacketField(
                Name: fieldName,
                CSharpType: effectiveType.FullName ?? effectiveType.Name,
                CType: ToCTypeFromReflection(effectiveType),
                Order: order,
                IsHeader: isHeader,
                Size: GetTypeSizeFromReflection(effectiveType),
                IsUnmanaged: effectiveType.IsValueType,
                IsNullable: isNullable,
                Comment: null
            ));
        }

        if (HasPacketAttribute(type) && !fields.Any(f => f.CType == "PacketHeader" || f.CSharpType.Contains("PacketHeader", StringComparison.Ordinal)))
        {
            fields.Insert(0, new PacketField("Header", KnownTypes.PacketHeader, "PacketHeader", -1, true, 6, true, false, "Implicit Packet Header"));
        }

        ushort opCode = TryGetStaticOpCodeFromType(type);

        return new PacketDefinition(
            Name: type.Name,
            FullName: type.FullName ?? type.Name,
            OpCode: opCode,
            Fields: fields,
            IsFixedSize: !fields.Any(f => f.Size == 0 || f.CType == "NalixString"),
            FixedSize: 0
        );
    }

    private static bool HasCustomAttribute(MemberInfo member, string attributeName)
    {
        return member.GetCustomAttributes().Any(a =>
            a.GetType().Name == attributeName ||
            a.GetType().FullName == attributeName ||
            a.GetType().Name == attributeName + "Attribute");
    }

    private static int GetAttributeOrder(MemberInfo member, string attributeName)
    {
        CustomAttributeData? attr = member.CustomAttributes.FirstOrDefault(a =>
            a.AttributeType.Name == attributeName ||
            a.AttributeType.FullName == attributeName ||
            a.AttributeType.Name == attributeName + "Attribute");

        if (attr != null && attr.ConstructorArguments.Count > 0 && attr.ConstructorArguments[0].Value is int order)
        {
            return order;
        }

        return 0;
    }

    private static ushort TryGetStaticOpCodeFromType(Type type)
    {
        PropertyInfo? prop = type.GetProperty("StaticOpCode", BindingFlags.Public | BindingFlags.Static);
        if (prop is null) return 0;
        object? val = prop.GetValue(null);
        return val switch
        {
            ushort u => u,
            int i and >= 0 and <= ushort.MaxValue => (ushort)i,
            short s and >= 0 => (ushort)s,
            byte b => b,
            uint ui and <= ushort.MaxValue => (ushort)ui,
            _ => 0
        };
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

        if (InheritsPacketBaseOfSelf(symbol) && !fields.Any(f => f.CType == "PacketHeader" || f.CSharpType.Contains("PacketHeader", StringComparison.Ordinal)))
        {
            fields.Insert(0, new PacketField("Header", KnownTypes.PacketHeader, "PacketHeader", -1, true, 6, true, false, "Implicit Packet Header"));
        }

        ushort opCode = TryGetStaticOpCode(symbol, semanticModel);

        return new PacketDefinition(
            Name: symbol.Name,
            FullName: symbol.ToDisplayString(),
            OpCode: opCode,
            Fields: fields,
            IsFixedSize: symbol.AllInterfaces.Any(i =>
                i.ToDisplayString() == KnownTypes.IFixedSizeSerializable),
            FixedSize: 0
        );
    }

    private static ushort TryGetStaticOpCode(INamedTypeSymbol symbol, SemanticModel semanticModel)
    {
        IPropertySymbol? prop = symbol.GetMembers("StaticOpCode")
            .OfType<IPropertySymbol>()
            .FirstOrDefault(static p => p.IsStatic);

        if (prop is null)
        {
            return 0;
        }

        foreach (SyntaxReference syntaxRef in prop.DeclaringSyntaxReferences)
        {
            if (syntaxRef.GetSyntax() is not PropertyDeclarationSyntax propSyntax)
            {
                continue;
            }

            ExpressionSyntax? expr = propSyntax.ExpressionBody?.Expression ?? propSyntax.Initializer?.Value;
            if (expr is null && propSyntax.AccessorList is not null)
            {
                AccessorDeclarationSyntax? getter = propSyntax.AccessorList.Accessors
                    .FirstOrDefault(static a => a.Keyword.ValueText == "get");
                expr = getter?.ExpressionBody?.Expression
                    ?? getter?.Body?.Statements.OfType<ReturnStatementSyntax>().FirstOrDefault()?.Expression;
            }

            if (expr is null)
            {
                continue;
            }

            SemanticModel model = ReferenceEquals(semanticModel.SyntaxTree, expr.SyntaxTree)
                ? semanticModel
                : semanticModel.Compilation.GetSemanticModel(expr.SyntaxTree);

            Optional<object?> constant = model.GetConstantValue(expr);
            if (!constant.HasValue || constant.Value is null)
            {
                continue;
            }

            switch (constant.Value)
            {
                case ushort u: return u;
                case int i and >= 0 and <= ushort.MaxValue: return (ushort)i;
                case short s and >= 0: return (ushort)s;
                case byte b: return b;
                case uint ui and <= ushort.MaxValue: return (ushort)ui;
            }
        }

        return 0;
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

        if (typeSymbol == null)
        {
            return null;
        }

        bool isNullable = typeSymbol.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T;
        ITypeSymbol effectiveType = isNullable && typeSymbol is INamedTypeSymbol named && named.TypeArguments.Length > 0
            ? named.TypeArguments[0]
            : typeSymbol;

        string cType = ToCType(effectiveType);
        int size = GetTypeSize(effectiveType);
        bool isUnmanaged = effectiveType.IsUnmanagedType;
        bool isHeader = HasAttribute(member, KnownAttributes.SerializeHeader);
        int order = isHeader ? GetOrder(member, KnownAttributes.SerializeHeader) : GetOrder(member, KnownAttributes.SerializeOrder);

        string fieldName = member.Name.TrimStart('_');
        if (fieldName.Length > 0 && char.IsLower(fieldName[0]))
        {
            fieldName = char.ToUpperInvariant(fieldName[0]) + fieldName.Substring(1);
        }

        return new PacketField(
            Name: fieldName,
            CSharpType: effectiveType.ToDisplayString(),
            CType: cType,
            Order: order,
            IsHeader: isHeader,
            Size: size,
            IsUnmanaged: isUnmanaged,
            IsNullable: isNullable,
            Comment: null
        );
    }

    private static string ToCType(ITypeSymbol type)
    {
        if (type.ToDisplayString() == KnownTypes.Bytes32)
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
            return "NalixString";
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
            _ => type.Name.Contains("PacketHeader", StringComparison.Ordinal) ? "PacketHeader" : "uint8_t"
        };
    }

    private static int GetTypeSize(ITypeSymbol type)
    {
        if (type.ToDisplayString() == KnownTypes.Bytes32)
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
            _ => 1
        };
    }

    private static string ToCTypeFromReflection(Type t)
    {
        if (t.FullName == KnownTypes.Bytes32)
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
            "String" => "NalixString",
            _ => t.Name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal) ? "NalixString" : "uint8_t"
        };
    }

    private static int GetTypeSizeFromReflection(Type t)
    {
        if (t.FullName == KnownTypes.Bytes32) return 32;
        if (t.Name.StartsWith("ReadOnlyMemory", StringComparison.Ordinal)) return 0;
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

    private static bool IsPacket(INamedTypeSymbol symbol)
        => symbol.GetAttributes().Any(a => a.AttributeClass?.ToDisplayString() == KnownAttributes.Packet) && InheritsPacketBaseOfSelf(symbol);
}
