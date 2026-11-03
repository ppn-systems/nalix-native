// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Protogen.Core.Models;

/// <summary>
/// Domain model representing an emitted source or header file.
/// </summary>
public sealed record GeneratedFile(
    string FileName,
    string Content,
    string RelativePath);
