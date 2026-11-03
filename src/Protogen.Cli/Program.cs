// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using Protogen.Core.Contracts;
using Protogen.Core.Models;
using Protogen.Core.Validation;
using Protogen.Engine.Analysis;
using Protogen.Engine.Generators.C;
using Protogen.Engine.Generators.Rust;

#pragma warning disable CA1303 // Do not pass literals as localized parameters
#pragma warning disable CA1848 // Use the LoggerMessage delegates
#pragma warning disable CA1849 // Call async methods when in an async method

namespace Protogen.Cli;

internal static class Program
{
    private const int ExitSuccess = 0;
    private const int ExitGeneralError = 1;
    private const int ExitValidationError = 2;
    private const int ExitUsageError = 64;

    private static async Task<int> Main(string[] args)
    {
        Console.WriteLine("Protogen Code Generator");
        Console.WriteLine("=======================\n");

        if (args.Length == 0 || args.Contains("--help") || args.Contains("-h"))
        {
            ShowHelp();
            return ExitSuccess;
        }

        string? projectPath = null;
        string? assemblyPath = null;
        string? cOut = null;
        string? rustOut = null;
        bool verbose = false;
        bool strict = false;

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
                case "--verbose":
                case "-v":
                    verbose = true;
                    break;
                case "--strict":
                    strict = true;
                    break;
                default:
                    Console.Error.WriteLine($"Error: Unrecognized option '{args[i]}'.\n");
                    ShowHelp();
                    return ExitUsageError;
            }
        }

        if (string.IsNullOrEmpty(projectPath) && string.IsNullOrEmpty(assemblyPath))
        {
            Console.Error.WriteLine("Error: Missing required --project (-p) or --assembly (-a) argument.\n");
            ShowHelp();
            return ExitUsageError;
        }

        if (string.IsNullOrEmpty(cOut) && string.IsNullOrEmpty(rustOut))
        {
            Console.Error.WriteLine("Error: At least one target output directory (--c-out or --rust-out) must be specified.\n");
            ShowHelp();
            return ExitUsageError;
        }

        try
        {
            // 1. Analyze contracts to build domain schemas
            IContractAnalyzer analyzer;
            string targetPath;

            if (!string.IsNullOrEmpty(projectPath))
            {
                analyzer = new RoslynProjectAnalyzer();
                targetPath = projectPath;
                Console.WriteLine($"Analyzing C# source project: {targetPath}");
            }
            else
            {
                analyzer = new ReflectionAssemblyAnalyzer();
                targetPath = assemblyPath!;
                Console.WriteLine($"Analyzing compiled assembly: {targetPath}");
            }

            IReadOnlyList<PacketSchema> packets = await analyzer.AnalyzeAsync(targetPath).ConfigureAwait(false);
            Console.WriteLine($"Discovered {packets.Count} packet definition(s).\n");

            // 2. Validate schemas against protocol invariants
            SchemaValidator validator = new();
            ValidationResult validationResult = validator.Validate(packets);

            if (validationResult.Diagnostics.Count > 0)
            {
                Console.WriteLine("Schema Validation Diagnostics:");
                foreach (SchemaDiagnostic diagnostic in validationResult.Diagnostics)
                {
                    string prefix = diagnostic.Severity switch
                    {
                        DiagnosticSeverity.Error => "  [ERROR]",
                        DiagnosticSeverity.Warning => "  [WARN] ",
                        _ => "  [INFO] "
                    };
                    Console.WriteLine($"{prefix} {diagnostic.Code}: {diagnostic.Message}");
                }
                Console.WriteLine();
            }

            if (!validationResult.IsValid)
            {
                Console.Error.WriteLine($"Validation failed with {validationResult.Errors.Count()} critical error(s). Generation aborted.");
                return ExitValidationError;
            }

            if (strict && validationResult.Warnings.Any())
            {
                Console.Error.WriteLine($"Validation failed due to --strict flag with {validationResult.Warnings.Count()} warning(s). Generation aborted.");
                return ExitValidationError;
            }

            // 3. Execute Code Generation per target language
            if (!string.IsNullOrEmpty(cOut))
            {
                await RunGeneratorAsync(new CGenerator(), packets, cOut).ConfigureAwait(false);
            }

            if (!string.IsNullOrEmpty(rustOut))
            {
                await RunGeneratorAsync(new RustGenerator(), packets, rustOut).ConfigureAwait(false);
            }

            Console.WriteLine("Code generation completed successfully.");
            return ExitSuccess;
        }
        catch (Exception ex) when (IsNonFatal(ex))
        {
            Console.Error.WriteLine($"\nExecution failed: {ex.Message}");
            if (verbose)
            {
                Console.Error.WriteLine(ex);
            }
            return ExitGeneralError;
        }
    }

    private static async Task RunGeneratorAsync(ICodeGenerator generator, IReadOnlyList<PacketSchema> packets, string outputDir)
    {
        Console.WriteLine($"Generating {generator.LanguageName} bindings...");
        Console.WriteLine($"  Output Directory: {outputDir}");

        IReadOnlyList<GeneratedFile> files = generator.Generate(packets);

        string fullDir = Path.GetFullPath(outputDir);
        _ = Directory.CreateDirectory(fullDir);

        int count = 0;
        foreach (GeneratedFile file in files)
        {
            string targetDir = string.IsNullOrEmpty(file.RelativePath)
                ? fullDir
                : Path.Combine(fullDir, file.RelativePath.TrimStart('/', '\\'));

            _ = Directory.CreateDirectory(targetDir);
            string filePath = Path.Combine(targetDir, file.FileName);

            await File.WriteAllTextAsync(filePath, file.Content).ConfigureAwait(false);
            Console.WriteLine($"  + {Path.Combine(file.RelativePath, file.FileName)}");
            count++;
        }

        Console.WriteLine($"  Summary: Emitted {count} file(s) for {generator.LanguageName}.\n");
    }

    private static bool IsNonFatal(Exception ex) =>
        ex is not (OutOfMemoryException or StackOverflowException or AccessViolationException);

    private static void ShowHelp()
    {
        Console.WriteLine("Description:");
        Console.WriteLine("  Code generator transforming C# packet schemas into unmanaged C (C99/ESP-IDF)");
        Console.WriteLine("  and Rust models with zero external dependencies.");
        Console.WriteLine();
        Console.WriteLine("Usage:");
        Console.WriteLine("  protogen [options]");
        Console.WriteLine();
        Console.WriteLine("Options:");
        Console.WriteLine("  -p, --project <path>     Path to the C# project (.csproj) containing packet contracts");
        Console.WriteLine("  -a, --assembly <path>    Path to the compiled C# assembly (.dll) containing packet contracts");
        Console.WriteLine("  --c-out <dir>            Output directory for generated C headers and source");
        Console.WriteLine("  --rust-out <dir>         Output directory for generated Rust modules");
        Console.WriteLine("  --strict                 Treat validation warnings as errors and abort generation");
        Console.WriteLine("  -v, --verbose            Enable verbose diagnostic output and stack traces");
        Console.WriteLine("  -h, --help               Display command-line help documentation");
        Console.WriteLine();
    }
}
