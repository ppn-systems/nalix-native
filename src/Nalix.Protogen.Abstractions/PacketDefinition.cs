// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Nalix.Protogen.Abstractions;

public sealed record PacketDefinition(
    string Name,
    string FullName,
    ushort OpCode,
    IReadOnlyList<PacketField> Fields,
    bool IsFixedSize,
    int FixedSize);
