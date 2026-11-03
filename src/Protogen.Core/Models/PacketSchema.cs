// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Protogen.Core.Models;

/// <summary>
/// Domain model representing a wire packet definition.
/// </summary>
public sealed record PacketSchema(
    string Name,
    string FullName,
    ushort OpCode,
    IReadOnlyList<FieldSchema> Fields,
    bool IsFixedSize,
    int FixedSize)
{
    /// <summary>
    /// Calculates total wire size for fixed-size fields.
    /// </summary>
    public int CalculateWireSize()
    {
        int size = 0;
        foreach (FieldSchema f in this.Fields)
        {
            size += f.Size;
        }
        return size;
    }

    /// <summary>
    /// Indicates whether the packet contains dynamic or variable-length fields (e.g. string, nullable).
    /// </summary>
    public bool HasVariableFields => this.Fields.Any(f => f.CType == "NalixString" || f.IsNullable);
}
