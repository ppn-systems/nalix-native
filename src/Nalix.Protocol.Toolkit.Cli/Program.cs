// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Nalix.Abstractions.Exceptions;
using Nalix.Protocol.Toolkit.Abstractions;
using Nalix.Protocol.Toolkit.Roslyn.C;
using Nalix.Protocol.Toolkit.Roslyn.Rust;

#pragma warning disable CA1303 // Do not pass literals as localized parameters

namespace Nalix.Protocol.Toolkit.Cli;

internal static class Program
{
    private static async Task Main(string[] args)
    {
        Console.WriteLine("Nalix.Protocol.Toolkit — Code Generator");
        Console.WriteLine("========================================\n");

        if (args.Length == 0 || args.Contains("--help") || args.Contains("-h"))
        {
            ShowHelp();
            return;
        }

        string? projectPath = null;
        string? assemblyPath = null;
        string? cOut = null;
        string? rustOut = null;
        bool verbose = false;

        for (int i = 0; i < args.Length; i++)
        {
            if (i + 1 >= args.Length && args[i] != "--verbose" && args[i] != "-v")
            {
                break;
            }

            switch (args[i])
            {
                case "--project":
                case "-p":
                    projectPath = args[++i];
                    break;
                case "--assembly":
                case "-a":
                    assemblyPath = args[++i];
                    break;
                case "--c-out":
                    cOut = args[++i];
                    break;
                case "--rust-out":
                    rustOut = args[++i];
                    break;
                case "--verbose":
                case "-v":
                    verbose = true;
                    break;
                default:
                    break;
            }
        }

        if (string.IsNullOrEmpty(projectPath) && string.IsNullOrEmpty(assemblyPath))
        {
            Console.WriteLine("Error: Missing required --project or --assembly argument.\n");
            ShowHelp();
            System.Environment.Exit(1);
        }

        if (string.IsNullOrEmpty(cOut) && string.IsNullOrEmpty(rustOut))
        {
            Console.WriteLine("Error: At least one of --c-out or --rust-out must be specified.\n");
            ShowHelp();
            System.Environment.Exit(1);
        }

        GenerationContext context = new(projectPath, assemblyPath, "", verbose);

        if (!string.IsNullOrEmpty(cOut))
        {
            await RunGeneratorAsync(new CHeaderGenerator(), context, cOut, "C", verbose).ConfigureAwait(false);
        }

        if (!string.IsNullOrEmpty(rustOut))
        {
            await RunGeneratorAsync(new RustGenerator(), context, rustOut, "Rust", verbose).ConfigureAwait(false);
        }
    }

    private static async Task RunGeneratorAsync(
        IPacketCodeGenerator generator,
        GenerationContext context,
        string outputDir,
        string language,
        bool verbose)
    {
        Console.WriteLine($"Generating {language} bindings...");

        if (!string.IsNullOrEmpty(context.ProjectPath))
        {
            Console.WriteLine($"  Project : {context.ProjectPath}");
        }
        if (!string.IsNullOrEmpty(context.AssemblyPath))
        {
            Console.WriteLine($"  Assembly: {context.AssemblyPath}");
        }
        Console.WriteLine($"  Output  : {outputDir}");
        Console.WriteLine();

        try
        {
            GeneratorResult result = await generator.GenerateAsync(context).ConfigureAwait(false);
            string fullDir = Path.GetFullPath(outputDir);
            _ = Directory.CreateDirectory(fullDir);

            int count = 0;
            foreach (GeneratedFile file in result.Files)
            {
                string dir = Path.Combine(fullDir, file.RelativePath.TrimStart('/', '\\'));
                _ = Directory.CreateDirectory(dir);

                string fullPath = Path.Combine(dir, file.FileName);
                await File.WriteAllTextAsync(fullPath, file.Content).ConfigureAwait(false);

                Console.WriteLine($"  {file.FileName}");
                count++;
            }

            Console.WriteLine($"  Generated {count} file(s) in: {fullDir}");
            Console.WriteLine();
        }
        catch (Exception ex) when (ExceptionClassifier.IsNonFatal(ex))
        {
            Console.WriteLine($"  ERROR: {ex.Message}");
            if (verbose)
            {
                Console.WriteLine(ex);
            }
            System.Environment.Exit(1);
        }
    }

    private static void ShowHelp()
    {
        Console.WriteLine("Usage:");
        Console.WriteLine("  nalix-protogen --project <path> --c-out <dir> [--rust-out <dir>] [options]");
        Console.WriteLine("  nalix-protogen --assembly <dll> --c-out <dir> [--rust-out <dir>] [options]");
        Console.WriteLine();
        Console.WriteLine("Options:");
        Console.WriteLine("  -p, --project     Path to .csproj file");
        Console.WriteLine("  -a, --assembly    Path to .dll file");
        Console.WriteLine("  --c-out           Output directory for C files (packets.h, packets.c, packet_test.c)");
        Console.WriteLine("  --rust-out        Output directory for Rust files (packets.rs, packet_tests.rs)");
        Console.WriteLine("  -v, --verbose     Show detailed information");
        Console.WriteLine();
        Console.WriteLine("Examples:");
        Console.WriteLine("  nalix-protogen -p ../../Nalix.Codec/Nalix.Codec.csproj --c-out ./c --rust-out ./rs");
        Console.WriteLine("  nalix-protogen -a ../../Nalix.Codec.dll --c-out ./generated/c");
        Console.WriteLine("  nalix-protogen -a ../../Nalix.Codec.dll --rust-out ./generated/rs");
    }
}
