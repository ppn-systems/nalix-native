// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Protogen.Core.Constants;
using Protogen.Core.Models;

namespace Protogen.Core.Validation;

/// <summary>
/// Production-grade schema validator enforcing wire invariants, opcode uniqueness,
/// field ordering integrity, and cross-platform compilation safety.
/// </summary>
public sealed class SchemaValidator : ISchemaValidator
{
    private static readonly HashSet<string> s_cReservedKeywords = new(StringComparer.Ordinal)
    {
        "auto", "break", "case", "char", "const", "continue", "default", "do", "double",
        "else", "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long",
        "register", "restrict", "return", "short", "signed", "sizeof", "static", "struct",
        "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "_Alignas",
        "_Alignof", "_Atomic", "_Bool", "_Complex", "_Generic", "_Imaginary", "_Noreturn",
        "_Static_assert", "_Thread_local"
    };

    public ValidationResult Validate(IReadOnlyList<PacketSchema> packets)
    {
        ArgumentNullException.ThrowIfNull(packets);

        List<SchemaDiagnostic> diagnostics = [];

        ValidateOpCodes(packets, diagnostics);
        ValidatePacketNames(packets, diagnostics);

        foreach (PacketSchema packet in packets)
        {
            ValidatePacketStructure(packet, diagnostics);
        }

        return new ValidationResult(diagnostics);
    }

    private static void ValidateOpCodes(IReadOnlyList<PacketSchema> packets, List<SchemaDiagnostic> diagnostics)
    {
        Dictionary<ushort, List<string>> opCodeMap = [];

        foreach (PacketSchema packet in packets)
        {
            if (packet.Name == ProtocolConstants.PacketHeaderName)
            {
                continue;
            }

            if (packet.OpCode == 0)
            {
                diagnostics.Add(new SchemaDiagnostic(
                    DiagnosticSeverity.Warning,
                    "PG002",
                    "Packet defines OpCode 0x0000, which is typically reserved or indicates an uninitialized StaticOpCode.",
                    packet.Name));
            }

            if (!opCodeMap.TryGetValue(packet.OpCode, out List<string>? packetList))
            {
                packetList = [];
                opCodeMap[packet.OpCode] = packetList;
            }

            packetList.Add(packet.Name);
        }

        foreach (KeyValuePair<ushort, List<string>> entry in opCodeMap)
        {
            if (entry.Value.Count > 1)
            {
                string colliding = string.Join(", ", entry.Value);
                diagnostics.Add(new SchemaDiagnostic(
                    DiagnosticSeverity.Error,
                    "PG001",
                    FormattableString.Invariant($"Duplicate OpCode 0x{entry.Key:X4} detected on packets: {colliding}. Each packet must possess a globally unique OpCode."),
                    entry.Value[0]));
            }
        }
    }

    private static void ValidatePacketNames(IReadOnlyList<PacketSchema> packets, List<SchemaDiagnostic> diagnostics)
    {
        Dictionary<string, List<string>> nameMap = new(StringComparer.OrdinalIgnoreCase);

        foreach (PacketSchema packet in packets)
        {
            if (!nameMap.TryGetValue(packet.Name, out List<string>? list))
            {
                list = [];
                nameMap[packet.Name] = list;
            }

            list.Add(packet.Name);
        }

        foreach (KeyValuePair<string, List<string>> entry in nameMap)
        {
            if (entry.Value.Count > 1)
            {
                string names = string.Join(", ", entry.Value);
                diagnostics.Add(new SchemaDiagnostic(
                    DiagnosticSeverity.Error,
                    "PG005",
                    $"Case-insensitive packet name collision detected: {names}. Target C language lacks namespaces and requires unique identifiers.",
                    entry.Value[0]));
            }
        }
    }

    private static void ValidatePacketStructure(PacketSchema packet, List<SchemaDiagnostic> diagnostics)
    {
        if (packet.Name == ProtocolConstants.PacketHeaderName)
        {
            return;
        }

        List<FieldSchema> nonHeaderFields = [.. packet.Fields.Where(f => !f.IsHeader)];

        if (nonHeaderFields.Count == 0)
        {
            diagnostics.Add(new SchemaDiagnostic(
                DiagnosticSeverity.Information,
                "PG004",
                "Packet defines no payload fields.",
                packet.Name));
        }

        // Validate field order duplicates
        Dictionary<int, List<string>> orderMap = [];
        foreach (FieldSchema field in nonHeaderFields)
        {
            if (field.Order >= 0)
            {
                if (!orderMap.TryGetValue(field.Order, out List<string>? list))
                {
                    list = [];
                    orderMap[field.Order] = list;
                }

                list.Add(field.Name);
            }

            // Check C reserved keyword
            if (s_cReservedKeywords.Contains(field.Name.ToLowerInvariant()))
            {
                diagnostics.Add(new SchemaDiagnostic(
                    DiagnosticSeverity.Warning,
                    "PG006",
                    FormattableString.Invariant($"Field name '{field.Name}' is a reserved keyword in ANSI C. May cause compiler conflicts in certain C standards."),
                    packet.Name,
                    field.Name));
            }
        }

        foreach (KeyValuePair<int, List<string>> entry in orderMap)
        {
            if (entry.Value.Count > 1)
            {
                string fields = string.Join(", ", entry.Value);
                diagnostics.Add(new SchemaDiagnostic(
                    DiagnosticSeverity.Error,
                    "PG003",
                    FormattableString.Invariant($"Duplicate SerializeOrder index {entry.Key} on fields: {fields}. Field ordering must be deterministic."),
                    packet.Name));
            }
        }

        // Wire size sanity check (> 64KB warning)
        if (packet.FixedSize > 65535)
        {
            diagnostics.Add(new SchemaDiagnostic(
                DiagnosticSeverity.Warning,
                "PG007",
                FormattableString.Invariant($"Packet wire size ({packet.FixedSize} bytes) exceeds 65535 bytes (typical IP/UDP MTU limit on embedded networks)."),
                packet.Name));
        }
    }
}
