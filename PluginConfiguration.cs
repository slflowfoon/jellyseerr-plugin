using MediaBrowser.Model.Plugins;

namespace JellySeerr;

public class PluginConfiguration : BasePluginConfiguration
{
    public string SeerrUrl { get; set; } = string.Empty;
    public string SeerrApiKey { get; set; } = string.Empty;
}
