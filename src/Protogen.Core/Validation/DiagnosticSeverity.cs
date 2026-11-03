// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Protogen.Core.Validation;

/// <summary>
/// Represents the severity level of a schema diagnostic message.
/// </summary>
public enum DiagnosticSeverity
{
    /// <summary>
    /// Informational notice regarding schema layout or optimization.
    /// </summary>
    Information = 0,

    /// <summary>
    /// Potential issue that does not prevent code generation but may cause runtime ambiguity.
    /// </summary>
    Warning = 1,

    /// <summary>
    /// Critical schema violation that will cause wire desynchronization or compiler failure.
    /// </summary>
    Error = 2
}
