
namespace Nalix.Protocol.Toolkit.Abstractions;

public interface IPacketCodeGenerator
{
    Task<GeneratorResult> GenerateAsync(GenerationContext context, CancellationToken ct = default);
}

public record GeneratorResult
{
    public IReadOnlyList<GeneratedFile> Files { get; init; }

    public GeneratorResult(params GeneratedFile[] files) => this.Files = files;
}

public record GeneratedFile(string FileName, string Content, string RelativePath = "");

public record GenerationContext
{
    public GenerationContext(string? projectPath, string? assemblyPath, string outputDirectory, bool verbose = false)
    {
        this.ProjectPath = projectPath;
        this.AssemblyPath = assemblyPath;
        this.OutputDirectory = outputDirectory;
        this.Verbose = verbose;
    }

    public string? ProjectPath { get; init; }
    public string? AssemblyPath { get; init; }
    public string OutputDirectory { get; init; }
    public bool Verbose { get; init; }

    public bool IsValid => !string.IsNullOrEmpty(this.ProjectPath) || !string.IsNullOrEmpty(this.AssemblyPath);
}
