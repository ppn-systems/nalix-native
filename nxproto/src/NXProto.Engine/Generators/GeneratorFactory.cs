// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Contracts;
using NXProto.Engine.Generators.C;
using NXProto.Engine.Generators.Rust;
using NXProto.Engine.Generators.TypeScript;

namespace NXProto.Engine.Generators;

/// <summary>
/// Domain factory resolving ICodeGenerator implementations by language identifier.
/// Adheres to Open/Closed Principle (OCP) and Dependency Inversion Principle (DIP).
/// </summary>
public sealed class GeneratorFactory : IGeneratorFactory
{
    private readonly Dictionary<string, ICodeGenerator> _generators;

    public GeneratorFactory()
    {
        CGenerator cGen = new();
        RustGenerator rustGen = new();
        TypeScriptGenerator tsGen = new();

        this._generators = new Dictionary<string, ICodeGenerator>(StringComparer.OrdinalIgnoreCase)
        {
            ["c"] = cGen,
            ["c99"] = cGen,
            ["rust"] = rustGen,
            ["rs"] = rustGen,
            ["typescript"] = tsGen,
            ["ts"] = tsGen
        };
    }

    public GeneratorFactory(IEnumerable<ICodeGenerator> customGenerators)
    {
        ArgumentNullException.ThrowIfNull(customGenerators);
        this._generators = new Dictionary<string, ICodeGenerator>(StringComparer.OrdinalIgnoreCase);
        foreach (ICodeGenerator gen in customGenerators)
        {
            this._generators[gen.LanguageName] = gen;
        }
    }

    public ICodeGenerator? GetGenerator(string language)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(language);
        return this._generators.GetValueOrDefault(language.Trim());
    }

    public IReadOnlyCollection<ICodeGenerator> GetAllGenerators()
    {
        return this._generators.Values.Distinct().ToList();
    }
}
