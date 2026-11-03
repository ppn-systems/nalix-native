// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using Protogen.Core.Constants;
using Protogen.Core.Contracts;
using Protogen.Core.Models;

namespace Protogen.Engine.Analysis;

/// <summary>
/// Analyzes C# projects using Roslyn MSBuildWorkspace to extract packet schemas.
/// </summary>
public sealed class RoslynProjectAnalyzer : IContractAnalyzer
{
    /// <inheritdoc/>
    public async Task<IReadOnlyList<PacketSchema>> AnalyzeAsync(string targetPath, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(targetPath);

        using MSBuildWorkspace workspace = MSBuildWorkspace.Create();
        _ = workspace.RegisterWorkspaceFailedHandler(e => Console.WriteLine($"[WARN] MSBuild: {e.Diagnostic.Message}"));

        Project project = await workspace.OpenProjectAsync(targetPath, cancellationToken: ct).ConfigureAwait(false);
        Compilation compilation = await project.GetCompilationAsync(ct).ConfigureAwait(false)
            ?? throw new InvalidOperationException($"Cannot obtain compilation from project: {targetPath}");

        List<PacketSchema> packets = new();
        HashSet<string> seen = new(StringComparer.Ordinal);

        // Standard Nalix v14 6-byte PacketHeader
        packets.Add(CreatePacketHeaderSchema());
        seen.Add(ProtocolConstants.PacketHeaderFullName);

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

                    PacketSchema? schema = BuildPacketSchema(symbol, semanticModel);
                    if (schema is not null)
                    {
                        packets.Add(schema);
                    }
                }
            }
        }

        return packets;
    }

    public static PacketSchema CreatePacketHeaderSchema()
    {
        List<FieldSchema> fields =
        [
            new FieldSchema("OpCode", "ushort", "uint16_t", "u16", 0, true, 2, true, false, null),
            new FieldSchema("Flags", "byte", "uint8_t", "u8", 2, true, 1, true, false, null),
            new FieldSchema("Priority", "byte", "uint8_t", "u8", 3, true, 1, true, false, null),
            new FieldSchema("SequenceId", "ushort", "uint16_t", "u16", 4, true, 2, true, false, null),
        ];

        return new PacketSchema(
            Name: ProtocolConstants.PacketHeaderName,
            FullName: ProtocolConstants.PacketHeaderFullName,
            OpCode: 0,
            Fields: fields,
            IsFixedSize: true,
            FixedSize: ProtocolConstants.PacketHeaderSize
        );
    }

    private static PacketSchema? BuildPacketSchema(INamedTypeSymbol symbol, SemanticModel semanticModel)
    {
        List<FieldSchema> fields = new();
        List<ISymbol> orderedMembers = GetOrderedMembers(symbol);

        foreach (ISymbol member in orderedMembers)
        {
            FieldSchema? field = BuildFieldSchema(member);
            if (field is not null)
            {
                fields.Add(field);
            }
        }

        if ((InheritsPacketBaseOfSelf(symbol) || IsPacket(symbol)) && !fields.Any(f => f.CType == ProtocolConstants.PacketHeaderName || f.CSharpType.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal)))
        {
            fields.Insert(0, new FieldSchema("Header", ProtocolConstants.PacketHeaderFullName, ProtocolConstants.PacketHeaderName, ProtocolConstants.PacketHeaderName, -1, true, ProtocolConstants.PacketHeaderSize, true, false, "Implicit Packet Header"));
        }

        ushort opCode = OpCodeEvaluator.Evaluate(symbol, semanticModel);

        bool isFixed = symbol.AllInterfaces.Any(i => i.ToDisplayString() == ContractMetadata.IFixedSizeSerializable)
            && !fields.Any(f => f.Size == 0 || f.CType == ProtocolConstants.StringCType || f.CType.EndsWith("Array", StringComparison.Ordinal) || f.IsNullable);

        return new PacketSchema(
            Name: symbol.Name,
            FullName: symbol.ToDisplayString(),
            OpCode: opCode,
            Fields: fields,
            IsFixedSize: isFixed,
            FixedSize: 0
        );
    }

    private static FieldSchema? BuildFieldSchema(ISymbol member)
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

        string cType = TypeResolver.ToCType(effectiveType);
        string rustType = TypeResolver.ToRustType(effectiveType);
        int size = TypeResolver.GetTypeSize(effectiveType);
        bool isUnmanaged = effectiveType.IsUnmanagedType && size > 0 && !cType.EndsWith("Array", StringComparison.Ordinal);
        bool isHeader = HasAttribute(member, ContractMetadata.SerializeHeaderAttribute);
        int order = isHeader ? GetOrder(member, ContractMetadata.SerializeHeaderAttribute) : GetOrder(member, ContractMetadata.SerializeOrderAttribute);

        string fieldName = member.Name.TrimStart('_');
        if (fieldName.Length > 0 && char.IsLower(fieldName[0]))
        {
            fieldName = char.ToUpperInvariant(fieldName[0]) + fieldName.Substring(1);
        }

        return new FieldSchema(
            Name: fieldName,
            CSharpType: effectiveType.ToDisplayString(),
            CType: cType,
            RustType: rustType,
            Order: order,
            IsHeader: isHeader,
            Size: size,
            IsUnmanaged: isUnmanaged,
            IsNullable: isNullable,
            Comment: null
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

                bool hasOrder = HasAttribute(member, ContractMetadata.SerializeOrderAttribute);
                bool hasHeader = HasAttribute(member, ContractMetadata.SerializeHeaderAttribute);
                bool hasIgnore = HasAttribute(member, ContractMetadata.SerializeIgnoreAttribute);

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

        IOrderedEnumerable<ISymbol> headers = allMembers
            .Where(m => HasAttribute(m, ContractMetadata.SerializeHeaderAttribute))
            .OrderBy(m => GetOrder(m, ContractMetadata.SerializeHeaderAttribute));

        IOrderedEnumerable<ISymbol> payload = allMembers
            .Where(m => HasAttribute(m, ContractMetadata.SerializeOrderAttribute))
            .OrderBy(m => GetOrder(m, ContractMetadata.SerializeOrderAttribute));

        return [.. headers, .. payload];
    }

    private static bool HasAttribute(ISymbol member, string attributeName)
        => member.GetAttributes().Any(a => a.AttributeClass?.ToDisplayString() == attributeName);

    private static int GetOrder(ISymbol member, string attributeName)
    {
        AttributeData? attr = member.GetAttributes().FirstOrDefault(a => a.AttributeClass?.ToDisplayString() == attributeName);
        return attr?.ConstructorArguments.FirstOrDefault().Value as int? ?? 0;
    }

    private static bool InheritsPacketBaseOfSelf(INamedTypeSymbol symbol)
    {
        INamedTypeSymbol? current = symbol.BaseType;
        while (current is not null)
        {
            if (current.Name == ContractMetadata.PacketBaseName &&
                current.ContainingNamespace?.ToDisplayString() == ContractMetadata.PacketBaseNamespace &&
                current.TypeArguments.Length == 1 &&
                SymbolEqualityComparer.Default.Equals(current.TypeArguments[0], symbol))
            {
                return true;
            }

            current = current.BaseType;
        }
        return false;
    }

    private static bool IsPacket(INamedTypeSymbol symbol)
        => symbol.GetAttributes().Any(a =>
            a.AttributeClass?.ToDisplayString() == ContractMetadata.PacketAttribute ||
            a.AttributeClass?.Name is "PacketAttribute" or "Packet");
}
