// Copyright (c) 2026 PPN Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0.

namespace NXProto.Cli;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        (CliOptions options, string? error) = CommandLineParser.Parse(args);

        if (options.ShowHelp)
        {
            CommandLineParser.PrintHelp();
            return 0;
        }

        if (error != null)
        {
            Console.WriteLine($"Error: {error}\n");
            CommandLineParser.PrintHelp();
            return 1;
        }

        try
        {
            return await GenerationRunner.RunAsync(options).ConfigureAwait(false);
        }
        catch (Exception ex) when (IsNonFatal(ex))
        {
            Console.WriteLine($"\nExecution failed: {ex.Message}");
            if (options.Verbose)
            {
                Console.WriteLine(ex);
            }
            return 1;
        }
    }

    private static bool IsNonFatal(Exception ex) =>
        ex is not (OutOfMemoryException or StackOverflowException or AccessViolationException);
}
