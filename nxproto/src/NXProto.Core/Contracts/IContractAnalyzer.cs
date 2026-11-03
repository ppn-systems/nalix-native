// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Models;

namespace NXProto.Core.Contracts;

/// <summary>
/// Abstraction for analyzing contract sources (project file or compiled assembly).
/// </summary>
public interface IContractAnalyzer
{
    /// <summary>
    /// Analyzes the specified contract target and returns discovered packet schemas.
    /// </summary>
    Task<IReadOnlyList<PacketSchema>> AnalyzeAsync(string targetPath, CancellationToken ct = default);
}
