// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Cli;
using Xunit;

namespace NXProto.Cli.Tests;

public sealed class CommandLineParserTests
{
    [Fact]
    public void Parse_EmptyArgs_ReturnsShowHelp()
    {
        (CliOptions options, string? error) = CommandLineParser.Parse([]);
        Assert.True(options.ShowHelp);
        Assert.Null(error);
    }

    [Theory]
    [InlineData("-h")]
    [InlineData("--help")]
    public void Parse_HelpFlag_ReturnsShowHelp(string flag)
    {
        (CliOptions options, string? error) = CommandLineParser.Parse([flag]);
        Assert.True(options.ShowHelp);
        Assert.Null(error);
    }

    [Fact]
    public void Parse_MissingSource_ReturnsError()
    {
        (CliOptions options, string? error) = CommandLineParser.Parse(["--c-out", "./dist/c"]);
        Assert.False(options.ShowHelp);
        Assert.NotNull(error);
        Assert.Contains("Missing required --project (-p) or --assembly (-a)", error, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_MissingOutputTargets_ReturnsError()
    {
        (CliOptions options, string? error) = CommandLineParser.Parse(["--project", "./Contracts.csproj"]);
        Assert.False(options.ShowHelp);
        Assert.NotNull(error);
        Assert.Contains("At least one target output directory", error, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_UnrecognizedOption_ReturnsError()
    {
        (CliOptions options, string? error) = CommandLineParser.Parse(["--unknown-option"]);
        Assert.False(options.ShowHelp);
        Assert.NotNull(error);
        Assert.Contains("Unrecognized option", error, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_ValidProjectAndOutputs_ParsesCorrectly()
    {
        string[] args =
        [
            "-p", "./src/Contracts/Contracts.csproj",
            "--c-out", "./gen/c",
            "--rust-out", "./gen/rust",
            "-t", "./gen/ts",
            "-v"
        ];

        (CliOptions options, string? error) = CommandLineParser.Parse(args);
        Assert.Null(error);
        Assert.False(options.ShowHelp);
        Assert.Equal("./src/Contracts/Contracts.csproj", options.ProjectPath);
        Assert.Equal("./gen/c", options.COutputDirectory);
        Assert.Equal("./gen/rust", options.RustOutputDirectory);
        Assert.Equal("./gen/ts", options.TypeScriptOutputDirectory);
        Assert.True(options.Verbose);
    }

    [Fact]
    public void Parse_ValidAssemblyAndOutputs_ParsesCorrectly()
    {
        string[] args =
        [
            "-a", "./bin/Release/Contracts.dll",
            "--ts-out", "./dist/ts"
        ];

        (CliOptions options, string? error) = CommandLineParser.Parse(args);
        Assert.Null(error);
        Assert.False(options.ShowHelp);
        Assert.Equal("./bin/Release/Contracts.dll", options.AssemblyPath);
        Assert.Equal("./dist/ts", options.TypeScriptOutputDirectory);
        Assert.Null(options.COutputDirectory);
        Assert.Null(options.RustOutputDirectory);
        Assert.False(options.Verbose);
    }
}
