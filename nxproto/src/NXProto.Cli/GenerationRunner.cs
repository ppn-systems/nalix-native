// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

using NXProto.Core.Contracts;
using NXProto.Core.Models;
using NXProto.Engine.Analysis;
using NXProto.Engine.Generators;

namespace NXProto.Cli;

/// <summary>
/// Orchestrates the analysis and code generation execution pipeline (SRP).
/// </summary>
public static class GenerationRunner
{
    public static async Task<int> RunAsync(CliOptions options, IGeneratorFactory? customFactory = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        IGeneratorFactory factory = customFactory ?? new GeneratorFactory();

        // 1. Analyze contracts
        IContractAnalyzer analyzer;
        string targetPath;

        if (!string.IsNullOrEmpty(options.ProjectPath))
        {
            analyzer = new RoslynProjectAnalyzer();
            targetPath = options.ProjectPath;
            Console.WriteLine($"Analyzing C# source project: {targetPath}");
        }
        else
        {
            analyzer = new ReflectionAssemblyAnalyzer();
            targetPath = options.AssemblyPath!;
            Console.WriteLine($"Analyzing compiled assembly: {targetPath}");
        }

        IReadOnlyList<PacketSchema> packets = await analyzer.AnalyzeAsync(targetPath).ConfigureAwait(false);
        Console.WriteLine($"Discovered {packets.Count} packet definition(s).\n");

        // 2. Generate code per target
        if (!string.IsNullOrEmpty(options.COutputDirectory))
        {
            ICodeGenerator? cGen = factory.GetGenerator("c");
            if (cGen != null)
            {
                await EmitFilesAsync(cGen, packets, options.COutputDirectory).ConfigureAwait(false);
            }
        }

        if (!string.IsNullOrEmpty(options.RustOutputDirectory))
        {
            ICodeGenerator? rustGen = factory.GetGenerator("rust");
            if (rustGen != null)
            {
                await EmitFilesAsync(rustGen, packets, options.RustOutputDirectory).ConfigureAwait(false);
            }
        }

        if (!string.IsNullOrEmpty(options.TypeScriptOutputDirectory))
        {
            ICodeGenerator? tsGen = factory.GetGenerator("typescript");
            if (tsGen != null)
            {
                await EmitFilesAsync(tsGen, packets, options.TypeScriptOutputDirectory).ConfigureAwait(false);
            }
        }

        Console.WriteLine("Code generation completed successfully.");
        return 0;
    }

    private static async Task EmitFilesAsync(ICodeGenerator generator, IReadOnlyList<PacketSchema> packets, string outputDir)
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
}
