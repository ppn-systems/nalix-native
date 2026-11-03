// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace NXProto.Core.Constants;

/// <summary>
/// Nalix protocol wire format constants and layout definitions.
/// </summary>
public static class ProtocolConstants
{
    /// <summary>
    /// Size of the Nalix v14 standard packet header in bytes.
    /// Layout: OpCode (2B) + Flags (1B) + Priority (1B) + SequenceId (2B).
    /// </summary>
    public const int PacketHeaderSize = 6;

    /// <summary>
    /// Type name of the packet header struct.
    /// </summary>
    public const string PacketHeaderName = "PacketHeader";

    /// <summary>
    /// Fully-qualified C# type name of the packet header.
    /// </summary>
    public const string PacketHeaderFullName = "Nalix.Abstractions.Primitives.PacketHeader";

    /// <summary>
    /// Fully-qualified C# type name for 32-byte hash/key arrays.
    /// </summary>
    public const string Bytes32FullName = "Nalix.Abstractions.Primitives.Bytes32";

    /// <summary>
    /// C type name for length-prefixed Nalix string.
    /// </summary>
    public const string StringCType = "NalixString";
}
