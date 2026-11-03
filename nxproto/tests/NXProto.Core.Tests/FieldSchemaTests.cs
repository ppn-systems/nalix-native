// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Models;
using Xunit;

namespace NXProto.Core.Tests;

public sealed class FieldSchemaTests
{
    [Fact]
    public void FieldSchema_RecordEquality_WorksAsExpected()
    {
        FieldSchema f1 = new("Status", "int", "int32_t", "i32", 1, false, 4, true, false, "Status code");
        FieldSchema f2 = new("Status", "int", "int32_t", "i32", 1, false, 4, true, false, "Status code");
        FieldSchema f3 = new("Status", "int", "int32_t", "i32", 2, false, 4, true, false, "Different order");

        Assert.Equal(f1, f2);
        Assert.NotEqual(f1, f3);
    }

    [Fact]
    public void GeneratedFile_RecordEquality_WorksAsExpected()
    {
        GeneratedFile gf1 = new("packets.h", "content", "include");
        GeneratedFile gf2 = new("packets.h", "content", "include");
        GeneratedFile gf3 = new("packets.c", "content", "src");

        Assert.Equal(gf1, gf2);
        Assert.NotEqual(gf1, gf3);
    }
}
