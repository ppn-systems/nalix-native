// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Protogen.Core.Contracts;

/// <summary>
/// Execution parameters for the code generator pipeline.
/// </summary>
public sealed record GenerationContext(
    string? ProjectPath,
    string? AssemblyPath,
    string? COutputDirectory,
    string? RustOutputDirectory,
    bool Verbose);
