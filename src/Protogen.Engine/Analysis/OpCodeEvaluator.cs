// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using System.Reflection;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Protogen.Engine.Analysis;

/// <summary>
/// Domain service responsible for extracting the static OpCode from packet declarations.
/// </summary>
public static class OpCodeEvaluator
{
    /// <summary>
    /// Evaluates the StaticOpCode property from a Roslyn type symbol.
    /// </summary>
    public static ushort Evaluate(INamedTypeSymbol symbol, SemanticModel semanticModel)
    {
        ArgumentNullException.ThrowIfNull(symbol);
        ArgumentNullException.ThrowIfNull(semanticModel);

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

    /// <summary>
    /// Evaluates the StaticOpCode property from an unmanaged reflection Type.
    /// </summary>
    public static ushort Evaluate(Type type)
    {
        ArgumentNullException.ThrowIfNull(type);

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
}
