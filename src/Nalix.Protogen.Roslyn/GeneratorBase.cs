// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Nalix.Protogen.Abstractions;

namespace Nalix.Protogen.Roslyn;

/// <summary>
/// Base class for all packet code generators.
/// Handles packet analysis via <see cref="PacketAnalyzer"/> and provides
/// a common iteration framework. Subclasses implement language-specific
/// code generation by overriding abstract methods.
/// </summary>
public abstract class GeneratorBase : IPacketCodeGenerator
{
    /// <inheritdoc/>
    public async Task<GeneratorResult> GenerateAsync(GenerationContext context, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(context);

        IReadOnlyList<PacketDefinition> packets = await AnalyzePacketsAsync(context, ct).ConfigureAwait(false);
        List<PacketDefinition> nonHeaderPackets = [.. packets.Where(p => p.Name != "PacketHeader")];

        List<GeneratedFile> files = new();
        this.GenerateFiles(packets, nonHeaderPackets, files);
        return new GeneratorResult([.. files]);
    }

    /// <summary>
    /// Analyzes packets from the given context (project or assembly).
    /// </summary>
    protected static async Task<IReadOnlyList<PacketDefinition>> AnalyzePacketsAsync(
        GenerationContext context, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (!string.IsNullOrEmpty(context.ProjectPath))
        {
            return await PacketAnalyzer.AnalyzeAsync(context.ProjectPath, ct).ConfigureAwait(false);
        }

        if (!string.IsNullOrEmpty(context.AssemblyPath))
        {
            return PacketAnalyzer.AnalyzeFromAssembly(context.AssemblyPath);
        }

        throw new ArgumentException("Either ProjectPath or AssemblyPath must be provided.");
    }

    /// <summary>
    /// Generates all output files. Override to control file structure.
    /// </summary>
    protected abstract void GenerateFiles(
        IReadOnlyList<PacketDefinition> allPackets,
        IReadOnlyList<PacketDefinition> nonHeaderPackets,
        List<GeneratedFile> files);

    /// <summary>
    /// Computes the wire size of a packet by summing field sizes.
    /// </summary>
    protected static int CalculateWireSize(PacketDefinition packet)
    {
        ArgumentNullException.ThrowIfNull(packet);

        int size = 0;
        foreach (PacketField f in packet.Fields)
        {
            size += GetFieldSize(f);
        }

        return size;
    }

    /// <summary>
    /// Gets the wire size of a single field.
    /// </summary>
    protected static int GetFieldSize(PacketField field)
    {
        ArgumentNullException.ThrowIfNull(field);

        if (field.CSharpType.Contains("PacketHeader", StringComparison.Ordinal))
        {
            return 6;
        }

        if (string.Equals(field.CSharpType, KnownTypes.Bytes32, StringComparison.Ordinal))
        {
            return 32;
        }

        return field.Size > 0
            ? field.Size
            : field.CType switch
            {
                "uint8_t" or "int8_t" => 1,
                "uint16_t" or "int16_t" => 2,
                "uint32_t" or "int32_t" => 4,
                "uint64_t" or "int64_t" => 8,
                _ => 4
            };
    }

    /// <summary>
    /// Maps a C# type name to a Rust type name.
    /// </summary>
    protected static string ToRustType(PacketField field)
    {
        ArgumentNullException.ThrowIfNull(field);

        string cs = field.CSharpType;

        if (cs.Contains("PacketHeader", StringComparison.Ordinal))
        {
            return "PacketHeader";
        }

        if (string.Equals(cs, KnownTypes.Bytes32, StringComparison.Ordinal))
        {
            return "[u8; 32]";
        }

        if (cs.Contains("ReadOnlyMemory", StringComparison.Ordinal))
        {
            return "Vec<u8>";
        }

        return cs switch
        {
            "byte" or "System.Byte" => "u8",
            "sbyte" or "System.SByte" => "i8",
            "short" or "System.Int16" => "i16",
            "ushort" or "System.UInt16" => "u16",
            "int" or "System.Int32" => "i32",
            "uint" or "System.UInt32" => "u32",
            "long" or "System.Int64" => "i64",
            "ulong" or "System.UInt64" => "u64",
            "float" or "System.Single" => "f32",
            "double" or "System.Double" => "f64",
            "bool" or "System.Boolean" => "u8",
            "string" or "System.String" => "Vec<u8>",
            _ => field.CType switch
            {
                "uint8_t" => "u8",
                "int8_t" => "i8",
                "uint16_t" => "u16",
                "int16_t" => "i16",
                "uint32_t" => "u32",
                "int32_t" => "i32",
                "uint64_t" => "u64",
                "int64_t" => "i64",
                _ => "u8"
            }
        };
    }
}
