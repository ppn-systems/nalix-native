// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Engine.Analysis;
using Xunit;

namespace NXProto.Engine.Tests;

public sealed class OpCodeEvaluatorTests
{
    private sealed class StaticOpCodePropertyClass
    {
        public static ushort StaticOpCode => 0x0501;
    }

    private sealed class ConstFieldOpCodeClass
    {
        public const ushort OpCode = 0x0502;
    }

    private sealed class NoOpCodeClass
    {
        public int Value { get; set; }
    }

    [Fact]
    public void Evaluate_ExtractsStaticOpCodeProperty()
    {
        ushort opcode = OpCodeEvaluator.Evaluate(typeof(StaticOpCodePropertyClass));
        Assert.Equal(0x0501, opcode);
    }

    [Fact]
    public void Evaluate_ExtractsConstFieldOpCode()
    {
        ushort opcode = OpCodeEvaluator.Evaluate(typeof(ConstFieldOpCodeClass));
        Assert.Equal(0x0502, opcode);
    }

    [Fact]
    public void Evaluate_ReturnsZeroWhenNoOpCodeFound()
    {
        ushort opcode = OpCodeEvaluator.Evaluate(typeof(NoOpCodeClass));
        Assert.Equal(0, opcode);
    }
}
