// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace NXProto.Core.Models;

/// <summary>
/// Domain model representing a single serialized field of a packet.
/// </summary>
public sealed record FieldSchema(
    string Name,
    string CSharpType,
    string CType,
    string RustType,
    int Order,
    bool IsHeader,
    int Size,
    bool IsUnmanaged,
    bool IsNullable,
    string? Comment);
