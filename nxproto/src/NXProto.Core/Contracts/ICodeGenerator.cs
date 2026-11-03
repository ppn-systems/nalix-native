// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Models;

namespace NXProto.Core.Contracts;

/// <summary>
/// Abstraction for target language code generation (e.g. C, Rust, TypeScript).
/// </summary>
public interface ICodeGenerator
{
    /// <summary>
    /// Target language name (e.g. "C", "Rust", "TypeScript").
    /// </summary>
    string LanguageName { get; }

    /// <summary>
    /// Generates code files for the provided packet schemas.
    /// </summary>
    IReadOnlyList<GeneratedFile> Generate(IReadOnlyList<PacketSchema> packets);
}
