// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Nalix.Abstractions.Networking.Packets;
using Nalix.Abstractions.Serialization;

namespace Nalix.Protocol.Toolkit.Roslyn;

/// <summary>
/// Centralized, type-safe attribute metadata names.
/// Sử dụng typeof để compiler check ngay, không còn hard-code string.
/// </summary>
internal static class KnownAttributes
{
    public static readonly string Packet = typeof(PacketAttribute).FullName!;

    public static readonly string SerializeOrder = typeof(SerializeOrderAttribute).FullName!;
    public static readonly string SerializeHeader = typeof(SerializeHeaderAttribute).FullName!;
    public static readonly string SerializeIgnore = typeof(SerializeIgnoreAttribute).FullName!;
    public static readonly string SerializePackable = typeof(SerializePackableAttribute).FullName!;
}
