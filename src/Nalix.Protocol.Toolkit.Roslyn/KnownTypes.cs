// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Nalix.Abstractions.Primitives;
using Nalix.Abstractions.Serialization;

namespace Nalix.Protocol.Toolkit.Roslyn;

/// <summary>
/// Centralized type-safe metadata cho analyzer.
/// Sử dụng typeof() để compiler check ngay, không còn magic string.
/// </summary>
internal static class KnownTypes
{
    /// <summary>
    /// Interface IFixedSizeSerializable nằm trong Nalix.Abstractions
    /// </summary>
    public static readonly string IFixedSizeSerializable =
        typeof(IFixedSizeSerializable).FullName!;

    /// <summary>
    /// Namespace của PacketBase<T> (nằm trong Nalix.Codec.DataFrames)
    /// </summary>
    public const string PacketBaseNamespace = "Nalix.Codec.DataFrames";

    /// <summary>
    /// Tên class PacketBase (dùng để check generic inheritance)
    /// </summary>
    public const string PacketBaseName = "PacketBase";

    // Low-level explicit structs
    public static readonly string PacketHeader = typeof(PacketHeader).FullName!;
}