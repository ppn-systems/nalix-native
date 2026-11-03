// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace NXProto.Cli;

/// <summary>
/// Parsed command line options for NXProto execution.
/// </summary>
public sealed record CliOptions(
    string? ProjectPath,
    string? AssemblyPath,
    string? COutputDirectory,
    string? RustOutputDirectory,
    string? TypeScriptOutputDirectory,
    bool Verbose,
    bool ShowHelp);

/// <summary>
/// Service responsible for parsing and validating CLI arguments (SRP).
/// </summary>
public static class CommandLineParser
{
    public static (CliOptions Options, string? ErrorMessage) Parse(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);

        if (args.Length == 0 || args.Contains("--help") || args.Contains("-h"))
        {
            return (new CliOptions(null, null, null, null, null, false, true), null);
        }

        string? projectPath = null;
        string? assemblyPath = null;
        string? cOut = null;
        string? rustOut = null;
        string? tsOut = null;
        bool verbose = false;

        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--project":
                case "-p":
                    if (i + 1 < args.Length) projectPath = args[++i];
                    break;
                case "--assembly":
                case "-a":
                    if (i + 1 < args.Length) assemblyPath = args[++i];
                    break;
                case "--c-out":
                    if (i + 1 < args.Length) cOut = args[++i];
                    break;
                case "--rust-out":
                    if (i + 1 < args.Length) rustOut = args[++i];
                    break;
                case "--ts-out":
                case "-t":
                    if (i + 1 < args.Length) tsOut = args[++i];
                    break;
                case "--verbose":
                case "-v":
                    verbose = true;
                    break;
                default:
                    return (new CliOptions(null, null, null, null, null, false, false),
                        $"Unrecognized option '{args[i]}'.");
            }
        }

        if (string.IsNullOrEmpty(projectPath) && string.IsNullOrEmpty(assemblyPath))
        {
            return (new CliOptions(null, null, null, null, null, false, false),
                "Missing required --project (-p) or --assembly (-a) argument.");
        }

        if (string.IsNullOrEmpty(cOut) && string.IsNullOrEmpty(rustOut) && string.IsNullOrEmpty(tsOut))
        {
            return (new CliOptions(null, null, null, null, null, false, false),
                "At least one target output directory (--c-out, --rust-out, or --ts-out) must be specified.");
        }

        return (new CliOptions(projectPath, assemblyPath, cOut, rustOut, tsOut, verbose, false), null);
    }

    public static void PrintHelp()
    {
        Console.WriteLine("NXProto - Protocol Contract Code Generator");
        Console.WriteLine("==========================================\n");
        Console.WriteLine("Description:");
        Console.WriteLine("  High-performance code generator transforming C# packet schemas into unmanaged C (C99/ESP-IDF),");
        Console.WriteLine("  Rust models, and TypeScript/Web classes with zero external dependencies.");
        Console.WriteLine();
        Console.WriteLine("Usage:");
        Console.WriteLine("  nxproto [options]");
        Console.WriteLine();
        Console.WriteLine("Options:");
        Console.WriteLine("  -p, --project <path>     Path to the C# project (.csproj) containing packet contracts");
        Console.WriteLine("  -a, --assembly <path>    Path to the compiled C# assembly (.dll) containing packet contracts");
        Console.WriteLine("  --c-out <dir>            Output directory for generated C headers and source");
        Console.WriteLine("  --rust-out <dir>         Output directory for generated Rust modules");
        Console.WriteLine("  -t, --ts-out <dir>       Output directory for generated TypeScript classes");
        Console.WriteLine("  -v, --verbose            Enable verbose diagnostic output and stack traces");
        Console.WriteLine("  -h, --help               Display command-line help documentation");
        Console.WriteLine();
    }
}
