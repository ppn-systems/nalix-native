// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Protogen.Core.Validation;

/// <summary>
/// Result of running schema verification across a collection of packet definitions.
/// </summary>
public sealed record ValidationResult(IReadOnlyList<SchemaDiagnostic> Diagnostics)
{
    /// <summary>
    /// Gets a value indicating whether the schema collection contains zero critical errors.
    /// </summary>
    public bool IsValid => !Diagnostics.Any(d => d.Severity == DiagnosticSeverity.Error);

    /// <summary>
    /// Gets all diagnostics with severity Error.
    /// </summary>
    public IEnumerable<SchemaDiagnostic> Errors => Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error);

    /// <summary>
    /// Gets all diagnostics with severity Warning.
    /// </summary>
    public IEnumerable<SchemaDiagnostic> Warnings => Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Warning);

    /// <summary>
    /// Creates a successful validation result without diagnostics.
    /// </summary>
    public static ValidationResult Success { get; } = new(Array.Empty<SchemaDiagnostic>());
}
