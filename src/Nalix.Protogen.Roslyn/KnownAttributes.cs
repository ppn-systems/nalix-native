// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace Nalix.Protogen.Roslyn;

/// <summary>
/// Centralized type metadata attribute names.
/// Decoupled from runtime assemblies so the analyzer can parse any Nalix version.
/// </summary>
internal static class KnownAttributes
{
    public const string Packet = "Nalix.Abstractions.Networking.Packets.PacketAttribute";
    public const string SerializeOrder = "Nalix.Abstractions.Serialization.SerializeOrderAttribute";
    public const string SerializeHeader = "Nalix.Abstractions.Serialization.SerializeHeaderAttribute";
    public const string SerializeIgnore = "Nalix.Abstractions.Serialization.SerializeIgnoreAttribute";
    public const string SerializePackable = "Nalix.Abstractions.Serialization.SerializePackableAttribute";
}
