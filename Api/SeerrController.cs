using System;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace JellySeerr.Api;

[ApiController]
[Route("plugins/JellySeerr")]
public class SeerrController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<SeerrController> _logger;

    public SeerrController(IHttpClientFactory httpClientFactory, ILogger<SeerrController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    private static (string Url, string Key) GetConfig()
    {
        var config = Plugin.Instance!.Configuration;
        return (config.SeerrUrl.TrimEnd('/'), config.SeerrApiKey);
    }

    /// <summary>Returns the injected client-side script.</summary>
    [HttpGet("ClientScript")]
    [AllowAnonymous]
    public IActionResult GetClientScript()
    {
        var stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream($"{typeof(Plugin).Namespace}.Web.main.js");

        if (stream is null) return NotFound();
        using var reader = new System.IO.StreamReader(stream);
        return Content(reader.ReadToEnd(), "application/javascript; charset=utf-8");
    }

    /// <summary>Search Seerr for movies and TV shows.</summary>
    [HttpGet("Search")]
    [Authorize]
    public Task<IActionResult> Search([FromQuery] string query, [FromQuery] string? mediaType)
    {
        var (url, key) = GetConfig();
        var path = $"/api/v1/search?query={Uri.EscapeDataString(query)}";
        if (!string.IsNullOrEmpty(mediaType)) path += $"&mediaType={mediaType}";
        return Proxy(url, key, path);
    }

    /// <summary>Get Seerr request status for a specific TMDB item.</summary>
    [HttpGet("Status/{mediaType}/{tmdbId:int}")]
    [Authorize]
    public Task<IActionResult> GetStatus(string mediaType, int tmdbId)
    {
        var (url, key) = GetConfig();
        var endpoint = mediaType.Equals("tv", StringComparison.OrdinalIgnoreCase) ? "tv" : "movie";
        return Proxy(url, key, $"/api/v1/{endpoint}/{tmdbId}");
    }

    /// <summary>Submit a media request to Seerr.</summary>
    [HttpPost("Request")]
    [Authorize]
    public async Task<IActionResult> CreateRequest([FromBody] JsonElement body)
    {
        var (url, key) = GetConfig();
        if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(key))
            return StatusCode(503, "JellySeerr not configured");

        try
        {
            var client = _httpClientFactory.CreateClient();
            var req = new HttpRequestMessage(HttpMethod.Post, $"{url}/api/v1/request");
            req.Headers.Add("X-Api-Key", key);
            req.Content = new StringContent(body.GetRawText(), Encoding.UTF8, "application/json");

            var resp = await client.SendAsync(req);
            var content = await resp.Content.ReadAsStringAsync();
            return Content(content, "application/json");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "JellySeerr: request submission failed");
            return StatusCode(500, "Request failed");
        }
    }

    private async Task<IActionResult> Proxy(string url, string key, string path)
    {
        if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(key))
            return StatusCode(503, "JellySeerr not configured — set URL and API key in plugin settings");

        try
        {
            var client = _httpClientFactory.CreateClient();
            var req = new HttpRequestMessage(HttpMethod.Get, $"{url}{path}");
            req.Headers.Add("X-Api-Key", key);

            var resp = await client.SendAsync(req);
            var content = await resp.Content.ReadAsStringAsync();
            return Content(content, "application/json");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "JellySeerr: proxy error for {Path}", path);
            return StatusCode(500, "Proxy error");
        }
    }
}
