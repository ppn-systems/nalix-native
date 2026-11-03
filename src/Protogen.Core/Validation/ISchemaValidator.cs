// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Protogen.Core.Models;

namespace Protogen.Core.Validation;

/// <summary>
/// Domain contract for validating packet schemas against wire-safety and target-language rules.
/// </summary>
public interface ISchemaValidator
{
    /// <summary>
    /// Validates the provided collection of packet schemas.
    /// </summary>
    /// <param name="packets">The schemas to validate.</param>
    /// <returns>A validation result containing any detected warnings or errors.</returns>
    ValidationResult Validate(IReadOnlyList<PacketSchema> packets);
}
