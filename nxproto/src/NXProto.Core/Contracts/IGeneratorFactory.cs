// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace NXProto.Core.Contracts;

/// <summary>
/// Factory abstraction for resolving code generators by target language identifier.
/// </summary>
public interface IGeneratorFactory
{
    /// <summary>
    /// Resolves code generator for the given language alias (e.g. "c", "rust", "typescript", "ts").
    /// </summary>
    ICodeGenerator? GetGenerator(string language);

    /// <summary>
    /// Returns all registered code generators.
    /// </summary>
    IReadOnlyCollection<ICodeGenerator> GetAllGenerators();
}
