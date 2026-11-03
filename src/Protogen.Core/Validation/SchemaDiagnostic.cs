// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Protogen.Core.Validation;

/// <summary>
/// Represents a structured diagnostic issued during schema analysis and validation.
/// </summary>
/// <param name="Severity">The severity level of the diagnostic.</param>
/// <param name="Code">Unique rule code identifying the violation (e.g. PG001).</param>
/// <param name="Message">Human-readable description of the violation and guidance.</param>
/// <param name="PacketName">The packet type name associated with this diagnostic, if applicable.</param>
/// <param name="FieldName">The field name associated with this diagnostic, if applicable.</param>
public sealed record SchemaDiagnostic(
    DiagnosticSeverity Severity,
    string Code,
    string Message,
    string? PacketName = null,
    string? FieldName = null)
{
    /// <inheritdoc />
    public override string ToString()
    {
        string location = string.IsNullOrEmpty(PacketName)
            ? "Global"
            : string.IsNullOrEmpty(FieldName)
                ? PacketName
                : $"{PacketName}.{FieldName}";

        return $"[{Severity.ToString().ToUpperInvariant()} {Code}] {location}: {Message}";
    }
}
