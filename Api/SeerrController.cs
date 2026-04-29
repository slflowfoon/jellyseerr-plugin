using System;
using System.Collections.Generic;
using System.Net.Mime;
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
        Response.Headers.CacheControl = "no-store, no-cache, max-age=0, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Expires = "0";
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

    /// <summary>Discover Seerr content for the custom Discover page.</summary>
    [HttpGet("Discover/{section}")]
    [Authorize]
    public Task<IActionResult> Discover(string section, [FromQuery] int page = 1)
    {
        var (url, key) = GetConfig();
        var path = section.ToLowerInvariant() switch
        {
            "trending" => "/api/v1/discover/trending",
            "movies" => "/api/v1/discover/movies",
            "tv" => "/api/v1/discover/tv",
            "upcoming-movies" => "/api/v1/discover/movies/upcoming",
            "upcoming-tv" => "/api/v1/discover/tv/upcoming",
            _ => string.Empty,
        };

        if (string.IsNullOrEmpty(path))
        {
            return Task.FromResult<IActionResult>(NotFound());
        }

        return Proxy(url, key, $"{path}?page={Math.Max(page, 1)}");
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

    /// <summary>Get Seerr requests so the client can notify when downloads begin.</summary>
    [HttpGet("Requests")]
    [Authorize]
    public Task<IActionResult> GetRequests(
        [FromQuery] string filter = "processing",
        [FromQuery] int take = 20,
        [FromQuery] int skip = 0,
        [FromQuery] string sort = "added")
    {
        var (url, key) = GetConfig();
        var safeFilter = filter.ToLowerInvariant() switch
        {
            "all" => "all",
            "pending" => "pending",
            "approved" => "approved",
            "available" => "available",
            "processing" => "processing",
            "unavailable" => "unavailable",
            "failed" => "failed",
            _ => "processing",
        };
        var safeSort = sort.ToLowerInvariant() switch
        {
            "added" => "added",
            "modified" => "modified",
            _ => "added",
        };

        var safeTake = Math.Clamp(take, 1, 100);
        var safeSkip = Math.Max(skip, 0);
        return Proxy(url, key, $"/api/v1/request?take={safeTake}&skip={safeSkip}&filter={safeFilter}&sort={safeSort}");
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
            var requestId = TryGetRequestId(body);
            var method = string.IsNullOrEmpty(requestId) ? HttpMethod.Post : HttpMethod.Put;
            var path = string.IsNullOrEmpty(requestId)
                ? "/api/v1/request"
                : $"/api/v1/request/{Uri.EscapeDataString(requestId)}";

            var client = _httpClientFactory.CreateClient();
            var req = new HttpRequestMessage(method, $"{url}{path}");
            req.Headers.Add("X-Api-Key", key);
            req.Content = new StringContent(SerializeRequestBody(body), Encoding.UTF8, MediaTypeNames.Application.Json);

            var resp = await client.SendAsync(req);
            return await ToProxyResult(resp);
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
            return await ToProxyResult(resp);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "JellySeerr: proxy error for {Path}", path);
            return StatusCode(500, "Proxy error");
        }
    }

    private static string? TryGetRequestId(JsonElement body)
    {
        if (!body.TryGetProperty("requestId", out var requestIdProp))
        {
            return null;
        }

        return requestIdProp.ValueKind switch
        {
            JsonValueKind.String => requestIdProp.GetString(),
            JsonValueKind.Number => requestIdProp.GetRawText(),
            _ => null,
        };
    }

    private static string SerializeRequestBody(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("requestId", out _))
        {
            return body.GetRawText();
        }

        var payload = new Dictionary<string, JsonElement>();
        foreach (var prop in body.EnumerateObject())
        {
            if (prop.NameEquals("requestId"))
            {
                continue;
            }

            payload[prop.Name] = prop.Value.Clone();
        }

        return JsonSerializer.Serialize(payload);
    }

    private static async Task<IActionResult> ToProxyResult(HttpResponseMessage resp)
    {
        var content = await resp.Content.ReadAsStringAsync();
        var contentType = resp.Content.Headers.ContentType?.ToString() ?? MediaTypeNames.Application.Json;

        return new ContentResult
        {
            Content = content,
            ContentType = contentType,
            StatusCode = (int)resp.StatusCode,
        };
    }
}
