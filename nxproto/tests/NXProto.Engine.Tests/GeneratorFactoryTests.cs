// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Contracts;
using NXProto.Engine.Generators;
using Xunit;

namespace NXProto.Engine.Tests;

public sealed class GeneratorFactoryTests
{
    [Theory]
    [InlineData("c", "C")]
    [InlineData("C99", "C")]
    [InlineData("rust", "Rust")]
    [InlineData("rs", "Rust")]
    [InlineData("typescript", "TypeScript")]
    [InlineData("ts", "TypeScript")]
    public void GetGenerator_ReturnsExpectedImplementation(string alias, string expectedLang)
    {
        GeneratorFactory factory = new();
        ICodeGenerator? generator = factory.GetGenerator(alias);

        Assert.NotNull(generator);
        Assert.Equal(expectedLang, generator.LanguageName);
    }

    [Fact]
    public void GetGenerator_ReturnsNullForUnknownLanguage()
    {
        GeneratorFactory factory = new();
        ICodeGenerator? generator = factory.GetGenerator("unknown_lang");

        Assert.Null(generator);
    }

    [Fact]
    public void GetAllGenerators_ReturnsAllThreeTargets()
    {
        GeneratorFactory factory = new();
        IReadOnlyCollection<ICodeGenerator> generators = factory.GetAllGenerators();

        Assert.Equal(3, generators.Count);
        Assert.Contains(generators, g => g.LanguageName == "C");
        Assert.Contains(generators, g => g.LanguageName == "Rust");
        Assert.Contains(generators, g => g.LanguageName == "TypeScript");
    }
}
