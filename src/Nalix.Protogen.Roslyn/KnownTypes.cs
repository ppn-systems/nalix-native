// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Nalix.Protogen.Roslyn;

/// <summary>
/// Centralized type-safe metadata for analyzer.
/// Decoupled from runtime assemblies so the analyzer can parse any Nalix version.
/// </summary>
internal static class KnownTypes
{
    public const string IFixedSizeSerializable = "Nalix.Abstractions.Serialization.IFixedSizeSerializable";
    public const string PacketBaseNamespace = "Nalix.Codec.DataFrames";
    public const string PacketBaseName = "PacketBase";
    public const string PacketHeader = "Nalix.Abstractions.Primitives.PacketHeader";
    public const string Bytes32 = "Nalix.Abstractions.Primitives.Bytes32";
    public const string IPacketStaticOpcode = "Nalix.Abstractions.Networking.Packets.IPacketStaticOpcode";
}
