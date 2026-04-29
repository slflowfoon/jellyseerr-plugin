using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace JellySeerr;

public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static Plugin? Instance { get; private set; }
    private readonly ILogger<Plugin> _logger;

    public static readonly Guid PluginGuid = Guid.Parse("3b4f8e2a-7c91-4d05-b3e6-1a2f9c847d30");

    public Plugin(
        IApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer,
        ILogger<Plugin> logger)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        _logger = logger;
        PatchWebIndex(applicationPaths.WebPath);
    }

    public override string Name => "JellySeerr";
    public override Guid Id => PluginGuid;
    public override string Description => "Request movies and TV shows via Seerr directly from Jellyfin.";

    public IEnumerable<PluginPageInfo> GetPages() =>
    [
        new PluginPageInfo
        {
            Name = "JellySeerrConfigPage",
            EmbeddedResourcePath = $"{GetType().Namespace}.Configuration.configPage.html"
        }
    ];

    private void PatchWebIndex(string webPath)
    {
        var indexPath = Path.Combine(webPath, "index.html");

        if (!File.Exists(indexPath))
        {
            _logger.LogWarning("JellySeerr: index.html not found at {Path}", indexPath);
            return;
        }

        var content = File.ReadAllText(indexPath);
        const string marker = "plugins/JellySeerr/ClientScript";
        var version = GetType().Assembly.GetName().Version?.ToString() ?? "1";
        var tag = $"""<script src="/plugins/JellySeerr/ClientScript?v={Uri.EscapeDataString(version)}" defer></script>""";

        if (content.Contains(marker, StringComparison.Ordinal))
        {
            var updated = Regex.Replace(
                content,
                """<script\b[^>]*\bsrc=["']/plugins/JellySeerr/ClientScript(?:\?[^"']*)?["'][^>]*>\s*</script>""",
                tag,
                RegexOptions.IgnoreCase);

            if (!string.Equals(content, updated, StringComparison.Ordinal))
            {
                File.WriteAllText(indexPath, updated);
                _logger.LogInformation("JellySeerr: Updated Jellyfin web client script version");
                return;
            }

            _logger.LogDebug("JellySeerr: index.html already patched with current script tag");
            return;
        }

        content = content.Replace("</head>", tag + "</head>", StringComparison.OrdinalIgnoreCase);
        File.WriteAllText(indexPath, content);
        _logger.LogInformation("JellySeerr: Patched Jellyfin web client");
    }
}
