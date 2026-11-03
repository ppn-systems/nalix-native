// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using System.Reflection;
using Protogen.Core.Constants;
using Protogen.Core.Contracts;
using Protogen.Core.Models;

namespace Protogen.Engine.Analysis;

/// <summary>
/// Analyzes compiled C# assemblies (.dll) via unmanaged reflection to extract packet schemas.
/// </summary>
public sealed class ReflectionAssemblyAnalyzer : IContractAnalyzer
{
    /// <inheritdoc/>
    public Task<IReadOnlyList<PacketSchema>> AnalyzeAsync(string targetPath, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(targetPath);

        List<PacketSchema> packets = new();
        packets.Add(RoslynProjectAnalyzer.CreatePacketHeaderSchema());

        Assembly assembly = Assembly.LoadFrom(targetPath);

        foreach (Type type in assembly.GetTypes())
        {
            if (type.IsAbstract || type.IsInterface || type.IsGenericType)
            {
                continue;
            }

            if (!HasPacketAttribute(type) && type.Name != ProtocolConstants.PacketHeaderName)
            {
                continue;
            }

            PacketSchema? schema = BuildPacketSchemaFromType(type);
            if (schema != null)
            {
                packets.Add(schema);
            }
        }

        return Task.FromResult<IReadOnlyList<PacketSchema>>(packets);
    }

    private static PacketSchema? BuildPacketSchemaFromType(Type type)
    {
        List<MemberInfo> allMembers = new();
        Type? currentType = type;

        while (currentType != null && currentType != typeof(object))
        {
            MemberInfo[] members = currentType.GetMembers(
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly);

            foreach (MemberInfo member in members)
            {
                if (member is not (FieldInfo or PropertyInfo))
                {
                    continue;
                }

                bool hasOrder = HasCustomAttribute(member, "SerializeOrder");
                bool hasHeader = HasCustomAttribute(member, "SerializeHeader");
                bool hasIgnore = HasCustomAttribute(member, "SerializeIgnore");

                if (hasIgnore)
                {
                    continue;
                }

                if (hasOrder || hasHeader)
                {
                    allMembers.Add(member);
                }
            }

            currentType = currentType.BaseType;
        }

        IOrderedEnumerable<MemberInfo> headers = allMembers
            .Where(m => HasCustomAttribute(m, "SerializeHeader"))
            .OrderBy(m => GetAttributeOrder(m, "SerializeHeader"));

        IOrderedEnumerable<MemberInfo> payload = allMembers
            .Where(m => HasCustomAttribute(m, "SerializeOrder"))
            .OrderBy(m => GetAttributeOrder(m, "SerializeOrder"));

        List<FieldSchema> fields = new();

        foreach (MemberInfo member in headers.Concat(payload))
        {
            Type memberType = member switch
            {
                FieldInfo f => f.FieldType,
                PropertyInfo p => p.PropertyType,
                _ => typeof(object)
            };

            bool isNullable = memberType.IsGenericType && memberType.GetGenericTypeDefinition() == typeof(Nullable<>);
            Type effectiveType = isNullable ? Nullable.GetUnderlyingType(memberType)! : memberType;

            bool isHeader = HasCustomAttribute(member, "SerializeHeader");
            int order = isHeader ? GetAttributeOrder(member, "SerializeHeader") : GetAttributeOrder(member, "SerializeOrder");

            string fieldName = member.Name.TrimStart('_');
            if (fieldName.Length > 0 && char.IsLower(fieldName[0]))
            {
                fieldName = char.ToUpperInvariant(fieldName[0]) + fieldName.Substring(1);
            }

            fields.Add(new FieldSchema(
                Name: fieldName,
                CSharpType: effectiveType.FullName ?? effectiveType.Name,
                CType: TypeResolver.ToCTypeFromReflection(effectiveType),
                RustType: TypeResolver.ToRustTypeFromReflection(effectiveType),
                Order: order,
                IsHeader: isHeader,
                Size: TypeResolver.GetTypeSizeFromReflection(effectiveType),
                IsUnmanaged: effectiveType.IsValueType,
                IsNullable: isNullable,
                Comment: null
            ));
        }

        if (HasPacketAttribute(type) && !fields.Any(f => f.CType == ProtocolConstants.PacketHeaderName || f.CSharpType.Contains(ProtocolConstants.PacketHeaderName, StringComparison.Ordinal)))
        {
            fields.Insert(0, new FieldSchema("Header", ProtocolConstants.PacketHeaderFullName, ProtocolConstants.PacketHeaderName, ProtocolConstants.PacketHeaderName, -1, true, ProtocolConstants.PacketHeaderSize, true, false, "Implicit Packet Header"));
        }

        ushort opCode = OpCodeEvaluator.Evaluate(type);

        return new PacketSchema(
            Name: type.Name,
            FullName: type.FullName ?? type.Name,
            OpCode: opCode,
            Fields: fields,
            IsFixedSize: !fields.Any(f => f.Size == 0 || f.CType == ProtocolConstants.StringCType),
            FixedSize: 0
        );
    }

    private static bool HasCustomAttribute(MemberInfo member, string attributeName)
    {
        return member.GetCustomAttributes().Any(a =>
            a.GetType().Name == attributeName ||
            a.GetType().FullName == attributeName ||
            a.GetType().Name == attributeName + "Attribute");
    }

    private static int GetAttributeOrder(MemberInfo member, string attributeName)
    {
        CustomAttributeData? attr = member.CustomAttributes.FirstOrDefault(a =>
            a.AttributeType.Name == attributeName ||
            a.AttributeType.FullName == attributeName ||
            a.AttributeType.Name == attributeName + "Attribute");

        if (attr != null && attr.ConstructorArguments.Count > 0 && attr.ConstructorArguments[0].Value is int order)
        {
            return order;
        }

        return 0;
    }

    private static bool HasPacketAttribute(Type type)
    {
        return type.GetCustomAttributes()
                   .Any(a => a.GetType().Name == "PacketAttribute");
    }
}
