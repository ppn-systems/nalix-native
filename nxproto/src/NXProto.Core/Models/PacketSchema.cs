// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Constants;

namespace NXProto.Core.Models;

/// <summary>
/// Domain model representing a wire packet definition and its validation invariants.
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
    /// Indicates whether the packet contains dynamic or variable-length fields (e.g. string, arrays, nullable).
    /// </summary>
    public bool HasVariableFields => this.Fields.Any(f =>
        f.CType == ProtocolConstants.StringCType ||
        f.CType.EndsWith("Array", StringComparison.Ordinal) ||
        f.IsNullable ||
        f.Size == 0);

    /// <summary>
    /// Validates domain invariants (non-empty name, distinct field orders).
    /// </summary>
    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(this.Name))
        {
            throw new InvalidOperationException("Packet name cannot be null or whitespace.");
        }

        HashSet<int> orders = [];
        foreach (FieldSchema field in this.Fields)
        {
            if (!orders.Add(field.Order))
            {
                throw new InvalidOperationException($"Duplicate field order '{field.Order}' detected in packet '{this.Name}'.");
            }
        }
    }
}
