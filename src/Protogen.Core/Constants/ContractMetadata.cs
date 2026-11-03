// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Protogen.Core.Constants;

/// <summary>
/// Metadata names for Nalix attributes and interfaces.
/// Decoupled from runtime assemblies so the analyzer can parse any Nalix contract version.
/// </summary>
public static class ContractMetadata
{
    public const string PacketAttribute = "Nalix.Abstractions.Networking.Packets.PacketAttribute";
    public const string SerializeOrderAttribute = "Nalix.Abstractions.Serialization.SerializeOrderAttribute";
    public const string SerializeHeaderAttribute = "Nalix.Abstractions.Serialization.SerializeHeaderAttribute";
    public const string SerializeIgnoreAttribute = "Nalix.Abstractions.Serialization.SerializeIgnoreAttribute";
    public const string SerializePackableAttribute = "Nalix.Abstractions.Serialization.SerializePackableAttribute";

    public const string IFixedSizeSerializable = "Nalix.Abstractions.Serialization.IFixedSizeSerializable";
    public const string PacketBaseNamespace = "Nalix.Codec.DataFrames";
    public const string PacketBaseName = "PacketBase";
    public const string IPacketStaticOpcode = "Nalix.Abstractions.Networking.Packets.IPacketStaticOpcode";
}
