// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using System.Reflection;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Protogen.Engine.Analysis;

/// <summary>
/// Domain service responsible for extracting the static OpCode from packet declarations.
/// Supports IPacketStaticOpcode, PacketOpcodeAttribute, and static/const OpCode declarations.
/// </summary>
public static class OpCodeEvaluator
{
    /// <summary>
    /// Evaluates the OpCode from a Roslyn type symbol.
    /// </summary>
    public static ushort Evaluate(INamedTypeSymbol symbol, SemanticModel semanticModel)
    {
        ArgumentNullException.ThrowIfNull(symbol);
        ArgumentNullException.ThrowIfNull(semanticModel);

        // 1. Check [PacketOpcode(ushort/enum)] attribute
        AttributeData? opcodeAttr = symbol.GetAttributes()
            .FirstOrDefault(a => a.AttributeClass?.Name is "PacketOpcode" or "PacketOpcodeAttribute");
        if (opcodeAttr is { ConstructorArguments.Length: > 0 } && opcodeAttr.ConstructorArguments[0].Value is object attrVal)
        {
            ushort? parsed = ToUInt16(attrVal);
            if (parsed.HasValue) return parsed.Value;
        }

        // 2. Check const fields: StaticOpCode, OpCode, OpCodeValue, OPCODE
        IFieldSymbol? constField = symbol.GetMembers()
            .OfType<IFieldSymbol>()
            .FirstOrDefault(f => f.IsConst && f.Name is "StaticOpCode" or "OpCode" or "OpCodeValue" or "OPCODE");
        if (constField?.ConstantValue != null)
        {
            ushort? parsed = ToUInt16(constField.ConstantValue);
            if (parsed.HasValue) return parsed.Value;
        }

        // 3. Check static property: StaticOpCode, OpCode
        IPropertySymbol? prop = symbol.GetMembers()
            .OfType<IPropertySymbol>()
            .FirstOrDefault(static p => p.IsStatic && p.Name is "StaticOpCode" or "OpCode");

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

            ushort? parsed = ToUInt16(constant.Value);
            if (parsed.HasValue) return parsed.Value;
        }

        return 0;
    }

    /// <summary>
    /// Evaluates the OpCode from an unmanaged reflection Type.
    /// </summary>
    public static ushort Evaluate(Type type)
    {
        ArgumentNullException.ThrowIfNull(type);

        // 1. PacketOpcodeAttribute
        CustomAttributeData? attr = type.CustomAttributes
            .FirstOrDefault(a => a.AttributeType.Name is "PacketOpcode" or "PacketOpcodeAttribute");
        if (attr != null && attr.ConstructorArguments.Count > 0 && attr.ConstructorArguments[0].Value != null)
        {
            ushort? parsed = ToUInt16(attr.ConstructorArguments[0].Value);
            if (parsed.HasValue) return parsed.Value;
        }

        // 2. Static properties: StaticOpCode, OpCode
        PropertyInfo? prop = type.GetProperty("StaticOpCode", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
            ?? type.GetProperty("OpCode", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
        if (prop != null)
        {
            object? val = prop.GetValue(null);
            if (val != null)
            {
                ushort? parsed = ToUInt16(val);
                if (parsed.HasValue) return parsed.Value;
            }
        }

        // 3. Const or static fields: StaticOpCode, OpCode, OpCodeValue, OPCODE
        FieldInfo? field = type.GetField("StaticOpCode", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
            ?? type.GetField("OpCode", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
            ?? type.GetField("OpCodeValue", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
            ?? type.GetField("OPCODE", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
        if (field != null)
        {
            object? val = field.GetValue(null);
            if (val != null)
            {
                ushort? parsed = ToUInt16(val);
                if (parsed.HasValue) return parsed.Value;
            }
        }

        return 0;
    }

    private static ushort? ToUInt16(object? val) => val switch
    {
        ushort u => u,
        int i and >= 0 and <= ushort.MaxValue => (ushort)i,
        short s and >= 0 => (ushort)s,
        byte b => b,
        sbyte sb and >= 0 => (ushort)sb,
        uint ui and <= ushort.MaxValue => (ushort)ui,
        long l and >= 0 and <= ushort.MaxValue => (ushort)l,
        ulong ul and <= ushort.MaxValue => (ushort)ul,
        _ => null
    };
}
