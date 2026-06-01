// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Nalix.Protogen.Abstractions;

public sealed record PacketField(
    string Name,
    string CSharpType,
    string CType,
    int Order,
    bool IsHeader,
    int Size,
    bool IsUnmanaged,
    string? Comment);
