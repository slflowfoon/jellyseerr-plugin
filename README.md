# JellySeerr

Jellyfin plugin that adds Seerr request functionality directly into the Jellyfin web interface.

## Features

- **Request button** on every movie and TV show detail page — shows current status (available, requested, or requestable)
- **Search modal** (floating button, bottom-right) to find and request any movie or show from TMDB, even if it's not in your library
- **Bell icon** on already-requested items
- All Seerr API calls are proxied through Jellyfin's server — no CORS issues, no credentials exposed to the browser

## Installation via Plugin Repository

1. In Jellyfin, go to **Dashboard → Plugins → Repositories**
2. Add repository URL: `https://raw.githubusercontent.com/slflowfoon/jellyseerr-plugin/main/manifest.json`
3. Go to **Catalogue**, find **JellySeerr**, install it
4. Restart Jellyfin
5. Go to **Dashboard → Plugins → JellySeerr** and enter your Seerr URL and API key

## Manual Installation

1. Download `JellySeerr.zip` from the latest release
2. Extract `JellySeerr.dll` into Jellyfin's plugin directory (e.g. `/config/plugins/`)
3. Restart Jellyfin and configure via Dashboard → Plugins

## Configuration

| Field | Description |
|-------|-------------|
| Seerr URL | Base URL of your Seerr instance, e.g. `http://192.168.1.100:5055` |
| API Key | Found in Seerr → Settings → General → API Key |

## Building from Source

Requires .NET 8 SDK.

```bash
dotnet build --configuration Release
```

## Releasing

Push a tag to trigger the build and publish workflow:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build the DLL, create a release, and update `manifest.json`.
