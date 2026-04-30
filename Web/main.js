(function () {
  'use strict';

  const GUID = '3b4f8e2a-7c91-4d05-b3e6-1a2f9c847d30';
  const API = '/plugins/JellySeerr';
  const DISCOVER_ROUTE = '#/home.html?jellyseerr=discover';
  const Status = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIAL: 4, AVAILABLE: 5 };
  const TRACKED_REQUESTS_KEY = 'jellyseerr_tracked_requests';
  const LATEST_LIBRARY_ITEMS_KEY = 'jellyseerr_latest_library_items';
  const REQUEST_POLL_MS = 120000;
  const PROCESSING_REQUEST_POLL_MS = 120000;
  const LATEST_LIBRARY_POLL_MS = 60000;
  const INITIAL_RECENT_TOAST_MS = 10 * 60 * 1000;
  const MAX_KNOWN_LATEST_ITEMS = 200;

  let lastHref = '';
  let lastDetailId = null;
  let retryTimer = null;
  let discoverSearchTimer = null;
  let discoverPageLoading = false;
  let discoverRequestInFlight = false;
  let requestPollTimer = null;
  let processingRequestPollTimer = null;
  let latestLibraryPollTimer = null;
  let discoverMounted = false;
  let comingSoonItems = [];
  let comingSoonPosition = 'top';
  let comingSoonConfigLoaded = false;
  let comingSoonConfigLoading = false;
  let comingSoonRenderTimer = null;
  let comingSoonHomeRenderAttemptsActive = false;
  let comingSoonHomeRenderAttemptToken = 0;
  let lastWasHomeRoute = false;
  let suppressBrowseAnchorRedirect = false;
  let discoverExitRefreshTimer = null;
  let lastNonDiscoverHash = '#/home.html';
  const discoverState = {
    sections: null,
    query: '',
    searchResults: null,
    loadingSearch: false,
    loadError: ''
  };

  function getToken() {
    try {
      const apiToken = window.ApiClient?.accessToken?.();
      if (apiToken) return apiToken;
      if (window.ApiClient?._serverInfo?.AccessToken) return window.ApiClient._serverInfo.AccessToken;
      const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
      return creds.Servers?.[0]?.AccessToken || '';
    } catch { return ''; }
  }

  function getUserId() {
    try {
      const apiUserId = window.ApiClient?.getCurrentUserId?.();
      if (typeof apiUserId === 'string') return apiUserId;
      if (window.ApiClient?._serverInfo?.UserId) return window.ApiClient._serverInfo.UserId;
      if (window.ApiClient?._currentUser?.Id) return window.ApiClient._currentUser.Id;
      const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
      return creds.Servers?.[0]?.UserId || creds.Servers?.[0]?.User?.Id || '';
    } catch { return ''; }
  }

  function ensurePluginStyles() {
    if (document.getElementById('js-seerr-styles')) return;

    const style = document.createElement('style');
    style.id = 'js-seerr-styles';
    style.textContent = [
      ':root { --js-seerr-accent: var(--theme-primary-color, #00a4dc); --js-seerr-surface: rgba(255,255,255,.04); --js-seerr-surface-strong: rgba(255,255,255,.08); --js-seerr-border: rgba(255,255,255,.08); }',
      '#js-seerr-discover.page { position: relative; box-sizing:border-box; width: 100%; min-height: 100%; z-index: 5; overflow: visible; padding: 3.3%; color: var(--theme-text-color, inherit); background: transparent; }',
      '#js-seerr-discover .content-primary { max-width: none; margin: 0; padding: 0; }',
      '.js-seerr-hero { display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; margin:0 0 1.2rem; }',
      '.js-seerr-title { margin:0; font-size:1.7rem; line-height:1.2; font-weight:600; }',
      '.js-seerr-actions { display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; }',
      '.js-seerr-pill { border:0; border-radius:.2em; padding:.65em 1em; background:var(--theme-primary-color, #00a4dc); color:#fff; cursor:pointer; font:inherit; }',
      '.js-seerr-searchbar { display:flex; align-items:center; gap:.75rem; margin:0 0 1.5rem; }',
      '.js-seerr-searchbar input { width:100%; color:inherit; font:inherit; }',
      '.js-seerr-section { margin-top:1.6rem; }',
      '.js-seerr-sectionHeader { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.75rem; }',
      '.js-seerr-sectionTitle { margin:0; font-size:1.25rem; font-weight:600; }',
      '.js-seerr-row { display:flex; gap:1rem; overflow-x:auto; padding:0 .25rem .5rem 0; }',
      '.js-seerr-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:1rem; }',
      '.js-seerr-card { display:flex; flex-direction:column; gap:.65rem; min-width:180px; }',
      '.js-seerr-poster { width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:12px; background:var(--js-seerr-surface); box-shadow: 0 0 0 1px var(--js-seerr-border); }',
      '.js-seerr-cardTitle { font-size:.98rem; font-weight:600; line-height:1.3; }',
      '.js-seerr-cardMeta { font-size:.78rem; color:var(--theme-secondary-text-color, #aaa); }',
      '.js-seerr-requestButton { margin-top:.15rem; border:none; border-radius:10px; padding:.75rem .9rem; color:#fff; font:inherit; font-weight:600; cursor:pointer; }',
      '.js-seerr-requestButton[disabled] { opacity:.65; cursor:default; }',
      '.js-seerr-status { padding:2rem 0; color:var(--theme-secondary-text-color, #aaa); }',
      '.js-seerr-toastHost { position:fixed; top:5.2rem; right:1rem; z-index:100002; display:flex; flex-direction:column; gap:.75rem; pointer-events:none; }',
      '.js-seerr-toast { min-width:280px; max-width:360px; background:rgba(24,24,24,.96); color:#fff; border-radius:14px; box-shadow:0 14px 40px rgba(0,0,0,.35); border:1px solid var(--js-seerr-border); padding:.95rem 1rem; transform:translateY(-6px); opacity:0; animation: jsSeerrToastIn .2s ease forwards; }',
      '.js-seerr-toastTitle { font-size:.9rem; color:var(--js-seerr-accent); margin-bottom:.25rem; }',
      '.js-seerr-toastBody { font-size:.98rem; line-height:1.35; }',
      '.js-seerr-comingSoonSection { margin:1.25rem 0 .9rem; padding:0 3.3%; color:var(--theme-text-color, #fff); }',
      '.js-seerr-comingSoonHeader { margin:0 0 .75rem; }',
      '.js-seerr-comingSoonTitle { margin:0; }',
      '.js-seerr-comingSoonRow { display:flex; gap:1rem; overflow-x:auto; overscroll-behavior-x:contain; touch-action:pan-x; padding:.2rem 0 .35rem; }',
      '.js-seerr-comingSoonCard { flex:0 0 170px; max-width:170px; display:flex; flex-direction:column; gap:.55rem; color:inherit; }',
      '.js-seerr-comingSoonPosterWrap { position:relative; width:100%; aspect-ratio:2/3; border:none; border-radius:8px; overflow:hidden; background:var(--js-seerr-surface); color:#fff; padding:0; box-shadow:0 0 0 1px var(--js-seerr-border); }',
      '.js-seerr-comingSoonPoster { width:100%; height:100%; object-fit:cover; display:block; }',
      '.js-seerr-comingSoonPosterFallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center; padding:1rem; text-align:center; color:var(--theme-secondary-text-color, #aaa); background:rgba(255,255,255,.04); }',
      '.js-seerr-comingSoonBadge { position:absolute; left:.5rem; top:.5rem; padding:.28rem .45rem; border-radius:4px; background:rgba(0,0,0,.78); color:#fff; font-size:.72rem; line-height:1; font-weight:700; text-transform:uppercase; }',
      '.js-seerr-comingSoonName { font-size:.95rem; line-height:1.25; font-weight:600; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }',
      '.js-seerr-comingSoonMeta { font-size:.78rem; color:var(--theme-secondary-text-color, #aaa); }',
      '.js-seerr-trailerOverlay { position:fixed; inset:0; z-index:100003; display:flex; align-items:center; justify-content:center; padding:1.5rem; background:rgba(0,0,0,.86); }',
      '.js-seerr-trailerDialog { width:min(960px, 96vw); }',
      '.js-seerr-trailerFrame { width:100%; aspect-ratio:16/9; border:0; background:#000; border-radius:8px; }',
      '.js-seerr-trailerClose { margin:.75rem 0 0 auto; display:block; border:none; border-radius:4px; padding:.65rem 1rem; background:#333; color:#fff; cursor:pointer; font:inherit; }',
      '#js-seerr-browse-btn { white-space:nowrap; display:inline-flex; align-items:center; gap:.55rem; }',
      '#js-seerr-browse-btn .material-icons { font-size:1.2em; }',
      '#js-seerr-nav { display:flex; align-items:center; }',
      '#js-seerr-nav .navMenuOptionText { margin-left:0 !important; }',
      '#js-seerr-nav .navMenuOptionIcon { margin-right:1.15rem; }',
      '@keyframes jsSeerrToastIn { to { transform:translateY(0); opacity:1; } }',
      '@media (max-width: 900px) { #js-seerr-discover.page { padding: 1rem; } .js-seerr-actions { width:100%; } .js-seerr-actions .js-seerr-pill { flex:1 1 auto; } .js-seerr-comingSoonSection { padding:0 1rem; } .js-seerr-comingSoonCard { flex-basis:140px; max-width:140px; } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function loadTrackedRequests() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRACKED_REQUESTS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveTrackedRequests(items) {
    localStorage.setItem(TRACKED_REQUESTS_KEY, JSON.stringify(items));
  }

  function loadKnownLatestItems() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LATEST_LIBRARY_ITEMS_KEY) || 'null');
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  }

  function saveKnownLatestItems(ids) {
    localStorage.setItem(LATEST_LIBRARY_ITEMS_KEY, JSON.stringify(ids.slice(0, MAX_KNOWN_LATEST_ITEMS)));
  }

  function normalizeComingSoonPosition(value) {
    value = String(value || '').trim().toLowerCase();
    const allowed = ['top', 'after-my-media', 'after-recently-added', 'bottom', 'disabled'];
    return allowed.includes(value) ? value : 'top';
  }

  function queueComingSoonRender(delay = 80, force = false) {
    if (comingSoonRenderTimer) {
      if (!force) return;
      clearTimeout(comingSoonRenderTimer);
      comingSoonRenderTimer = null;
    }

    comingSoonRenderTimer = setTimeout(() => {
      comingSoonRenderTimer = null;
      renderComingSoonSection();
    }, delay);
  }

  function scheduleComingSoonHomeRenderAttempts(force = false) {
    if (comingSoonHomeRenderAttemptsActive && !force) return;
    comingSoonHomeRenderAttemptsActive = true;
    const token = ++comingSoonHomeRenderAttemptToken;

    [0, 150, 400, 800, 1500, 2500, 4000, 6500, 10000].forEach((delay, index, delays) => {
      setTimeout(() => {
        if (token !== comingSoonHomeRenderAttemptToken) return;
        if (isHomeRoute() && !isDiscoverRoute()) {
          queueComingSoonRender(0, true);
        }
        if (index === delays.length - 1) {
          comingSoonHomeRenderAttemptsActive = false;
        }
      }, delay);
    });
  }

  function trackRequestedItem(mediaType, mediaId, title) {
    const tracked = loadTrackedRequests().filter(item => !(item.mediaType === mediaType && item.mediaId === mediaId));
    tracked.push({
      mediaType: mediaType,
      mediaId: mediaId,
      title: title || 'Requested item',
      notified: false,
      trackedAt: Date.now()
    });
    saveTrackedRequests(tracked);
  }

  function ensureToastHost() {
    let host = document.getElementById('js-seerr-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'js-seerr-toast-host';
      host.className = 'js-seerr-toastHost';
      document.body.appendChild(host);
    }
    return host;
  }

  function showToast(title, body) {
    const host = ensureToastHost();
    const toast = document.createElement('div');
    toast.className = 'js-seerr-toast';
    toast.innerHTML = [
      '<div class="js-seerr-toastTitle">' + escHtml(title) + '</div>',
      '<div class="js-seerr-toastBody">' + escHtml(body) + '</div>'
    ].join('');
    host.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(() => toast.remove(), 220);
    }, 5200);
  }

  function showTestToast() {
    showToast('JellySeerr Test', 'This is a test notification from the JellySeerr plugin.');
  }

  async function apiFetch(path, opts = {}) {
    const token = getToken();
    if (!token) throw new Error('Missing Jellyfin token');
    const headers = { 'X-MediaBrowser-Token': token, ...opts.headers };
    const resp = await fetch(path, { ...opts, headers });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }

  function getItemId() {
    const src = window.location.hash + window.location.search;
    const m = src.match(/[?&]id=([^&]+)/);
    return m ? m[1] : null;
  }

  function isDetailPage() {
    return /\/details|#.*details/i.test(window.location.href);
  }

  function isDiscoverRoute() {
    return window.location.hash.includes('jellyseerr=discover');
  }

  function isPlaybackRoute() {
    return /\/video|\/playback|#.*video|#.*playback/i.test(window.location.href);
  }

  function isHomeRoute() {
    const hash = window.location.hash || '';
    return !isDiscoverRoute() && /^#!?\/(?:home(?:\.html)?|)(?:[?&].*)?$/i.test(hash || '#/');
  }

  function findBrowseButton(labelPattern) {
    return Array.from(document.querySelectorAll('button,a')).find(el => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.id === 'js-seerr-browse-btn' || el.closest('#js-seerr-discover')) return false;
      return labelPattern.test((el.textContent || '').trim());
    }) || null;
  }

  function getRouteHrefWithoutDiscover() {
    if (/^#!?\//.test(window.location.hash) && !isDiscoverRoute()) return window.location.hash;
    return lastNonDiscoverHash || '#/home.html';
  }

  function rememberNonDiscoverRoute() {
    if (/^#!?\//.test(window.location.hash) && !isDiscoverRoute()) {
      lastNonDiscoverHash = window.location.hash;
    }
  }

  async function getJellyfinItem(itemId) {
    try {
      return await apiFetch('/Items/' + itemId + '?Fields=ProviderIds');
    } catch { return null; }
  }

  async function seerrStatus(mediaType, tmdbId) {
    try {
      return await apiFetch(API + '/Status/' + mediaType + '/' + tmdbId);
    } catch { return null; }
  }

  async function seerrMediaDetails(mediaType, tmdbId) {
    if (!tmdbId) return null;
    return seerrStatus(mediaType === 'tv' ? 'tv' : 'movie', tmdbId);
  }

  async function seerrSearch(query) {
    try {
      return await apiFetch(API + '/Search?query=' + encodeURIComponent(query));
    } catch { return null; }
  }

  async function seerrDiscover(section, page = 1) {
    try {
      return await apiFetch(API + '/Discover/' + section + '?page=' + page);
    } catch { return null; }
  }

  async function seerrRequest(mediaType, mediaId, opts = {}) {
    const body = {
      mediaType: mediaType,
      mediaId: Number(mediaId)
    };

    if (opts.requestId != null) body.requestId = opts.requestId;
    if (opts.is4k === true) body.is4k = true;
    if (mediaType === 'tv' && Array.isArray(opts.seasons)) {
      body.seasons = opts.seasons.map(Number).filter(Number.isFinite);
    }

    try {
      return await apiFetch(API + '/Request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch { return null; }
  }

  async function seerrRequests(filter = 'processing') {
    try {
      return await apiFetch(API + '/Requests?filter=' + encodeURIComponent(filter) + '&take=50&skip=0&sort=added');
    } catch { return null; }
  }

  async function seerrComingSoonRequests() {
    const response = await seerrRequests('processing');
    const byKey = new Map();

    normalizeRequestItems(response)
      .filter(isComingSoonRequest)
      .forEach(request => {
        const key = getRequestProcessingKey(request);
        if (key) byKey.set(key, request);
      });

    return Array.from(byKey.values());
  }

  async function jellyfinLatestLibraryItems() {
    const userId = getUserId();
    if (!userId) return [];

    try {
      return await apiFetch('/Users/' + encodeURIComponent(userId) + '/Items/Latest?Limit=30&IncludeItemTypes=Movie,Series&Fields=DateCreated,ProviderIds');
    } catch {
      return [];
    }
  }

  async function loadPluginRuntimeConfig() {
    if (comingSoonConfigLoading) return;
    if (!getToken()) {
      setTimeout(loadPluginRuntimeConfig, 1000);
      return;
    }

    comingSoonConfigLoading = true;
    try {
      const cfg = await apiFetch(API + '/RuntimeConfig');
      comingSoonPosition = normalizeComingSoonPosition(cfg.ComingSoonPosition || 'top');
      comingSoonConfigLoaded = true;
      scheduleComingSoonHomeRenderAttempts();
    } catch {
      comingSoonConfigLoaded = false;
      setTimeout(loadPluginRuntimeConfig, 3000);
    } finally {
      comingSoonConfigLoading = false;
    }
  }

  function normalizeMediaType(item) {
    return item?.mediaType || item?.type || item?.mediaInfo?.mediaType || 'movie';
  }

  function normalizeTitle(item) {
    return item?.title || item?.name || 'Unknown';
  }

  function normalizeYear(item) {
    const value = item?.releaseDate || item?.firstAirDate || item?.release_date || item?.first_air_date || '';
    return String(value).slice(0, 4);
  }

  function normalizePoster(item, size) {
    if (item?.posterPath) {
      return 'https://image.tmdb.org/t/p/' + size + item.posterPath;
    }
    return null;
  }

  function posterUrl(path, size = 'w342') {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    return 'https://image.tmdb.org/t/p/' + size + path;
  }

  function statusInfo(status, mediaType) {
    switch (status) {
      case Status.AVAILABLE:
        return { label: 'In Library', color: '#4caf50', disabled: true };
      case Status.PENDING:
      case Status.PROCESSING:
        return mediaType === 'tv'
          ? { label: 'Edit Request', color: '#ff9800', disabled: false }
          : { label: 'Requested', color: '#ff9800', disabled: true };
      case Status.PARTIAL:
        return mediaType === 'tv'
          ? { label: 'Request Seasons', color: '#ff9800', disabled: false }
          : { label: 'Partial', color: '#ff9800', disabled: true };
      default:
        return mediaType === 'tv'
          ? { label: 'Request Seasons', color: '#00a4dc', disabled: false }
          : { label: 'Request', color: '#00a4dc', disabled: false };
    }
  }

  function getFirstRequestId(data) {
    const request = data?.mediaInfo?.requests?.[0];
    return request ? request.id : null;
  }

  function getRequestedSeasonNumbers(data) {
    const request = data?.mediaInfo?.requests?.[0];
    const seasons = request?.seasons;
    if (!Array.isArray(seasons)) return [];

    return seasons
      .map(season => typeof season === 'number' ? season : season?.seasonNumber)
      .filter(Number.isFinite)
      .map(Number);
  }

  function seasonStatusInfo(status) {
    switch (status) {
      case Status.AVAILABLE:
        return { label: 'Available', color: '#4caf50' };
      case Status.PENDING:
      case Status.PROCESSING:
        return { label: 'Requested', color: '#ff9800' };
      case Status.PARTIAL:
        return { label: 'Partial', color: '#ff9800' };
      default:
        return { label: 'Missing', color: '#00a4dc' };
    }
  }

  function normalizeSeasonData(data) {
    const requested = new Set(getRequestedSeasonNumbers(data));
    const seasons = Array.isArray(data?.seasons) ? data.seasons : [];

    return seasons
      .filter(season => Number.isFinite(season?.seasonNumber) && season.seasonNumber > 0)
      .map(season => {
        const seasonNumber = Number(season.seasonNumber);
        const status = Number.isFinite(season?.status) ? Number(season.status) : Status.UNKNOWN;
        return {
          seasonNumber: seasonNumber,
          name: season.name || ('Season ' + seasonNumber),
          episodeCount: season.episodeCount,
          status: status,
          selected: requested.size ? requested.has(seasonNumber) : status !== Status.AVAILABLE
        };
      });
  }

  function openSeasonPicker(data) {
    const seasons = normalizeSeasonData(data);
    if (!seasons.length) return Promise.resolve(null);

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'js-seerr-seasons';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:100001',
        'background:rgba(0,0,0,.82)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'padding:20px'
      ].join(';');

      const rows = seasons.map(season => {
        const info = seasonStatusInfo(season.status);
        const count = season.episodeCount ? ' · ' + season.episodeCount + ' eps' : '';
        return [
          '<label style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);cursor:pointer">',
          '  <span style="display:flex;flex-direction:column;min-width:0">',
          '    <span style="font-weight:600">' + escHtml(season.name) + '</span>',
          '    <span style="font-size:12px;color:' + info.color + '">' + escHtml(info.label + count) + '</span>',
          '  </span>',
          '  <input type="checkbox" data-season="' + season.seasonNumber + '"' + (season.selected ? ' checked' : '') + ' />',
          '</label>'
        ].join('');
      }).join('');

      overlay.innerHTML = [
        '<div style="width:100%;max-width:520px;max-height:80vh;overflow:auto;background:#181818;color:#fff;border-radius:10px;padding:18px 18px 14px;box-shadow:0 18px 50px rgba(0,0,0,.45)">',
        '  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">',
        '    <h3 style="margin:0;font-size:20px">Request Seasons</h3>',
        '    <button type="button" data-action="close" style="padding:8px 12px;border:none;border-radius:6px;background:#444;color:#fff;cursor:pointer">Close</button>',
        '  </div>',
        '  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px">',
        '    <button type="button" data-action="toggle-all" style="padding:8px 12px;border:none;border-radius:6px;background:#2d2d2d;color:#fff;cursor:pointer">Toggle All</button>',
        '    <button type="button" data-action="submit" style="padding:8px 12px;border:none;border-radius:6px;background:#00a4dc;color:#fff;cursor:pointer">Submit Request</button>',
        '  </div>',
        rows,
        '</div>'
      ].join('');

      function finish(value) {
        overlay.remove();
        resolve(value);
      }

      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(null);
      });

      overlay.querySelector('[data-action="close"]').addEventListener('click', () => finish(null));
      overlay.querySelector('[data-action="toggle-all"]').addEventListener('click', () => {
        const inputs = Array.from(overlay.querySelectorAll('input[type="checkbox"]'));
        const allChecked = inputs.every(input => input.checked);
        inputs.forEach(input => { input.checked = !allChecked; });
      });
      overlay.querySelector('[data-action="submit"]').addEventListener('click', () => {
        const selected = Array.from(overlay.querySelectorAll('input[type="checkbox"]:checked'))
          .map(input => Number(input.getAttribute('data-season')))
          .filter(Number.isFinite);
        finish(selected.length ? selected : null);
      });

      document.body.appendChild(overlay);
    });
  }

  async function submitRequest(button, mediaType, mediaId, data) {
    const requestId = getFirstRequestId(data);

    if (mediaType === 'tv') {
      const seasons = await openSeasonPicker(data);
      if (!seasons?.length) return false;
      button.textContent = 'Requesting...';
      button.disabled = true;
      return Boolean(await seerrRequest(mediaType, mediaId, {
        requestId: requestId,
        seasons: seasons
      }));
    }

    button.textContent = 'Requesting...';
    button.disabled = true;
    return Boolean(await seerrRequest(mediaType, mediaId, { requestId: requestId }));
  }

  async function pollTrackedRequests() {
    const tracked = loadTrackedRequests();
    if (!tracked.length) return;

    const deferToasts = isPlaybackRoute();
    const nextTracked = [];
    for (const item of tracked) {
      const data = await seerrStatus(item.mediaType, item.mediaId);
      const status = data?.mediaInfo?.status;

      if (status === Status.AVAILABLE) {
        if (deferToasts) {
          nextTracked.push(item);
        } else {
          showToast('Available in Jellyfin', item.title + ' is now in your library.');
        }
        continue;
      }

      nextTracked.push(item);
    }

    saveTrackedRequests(nextTracked);
  }

  function startRequestPolling() {
    clearInterval(requestPollTimer);
    pollTrackedRequests();
    requestPollTimer = setInterval(pollTrackedRequests, REQUEST_POLL_MS);
  }

  function normalizeRequestItems(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    return [];
  }

  function getRequestMedia(request) {
    return request?.media || request?.mediaInfo || request?.requestedMedia || null;
  }

  function getRequestMediaType(request) {
    const media = getRequestMedia(request);
    const value = request?.type || request?.mediaType || media?.mediaType || media?.type || '';
    return String(value).toLowerCase() === 'tv' ? 'tv' : 'movie';
  }

  function getRequestTmdbId(request) {
    const media = getRequestMedia(request);
    return media?.tmdbId || media?.tmdbid || request?.mediaId || request?.tmdbId || request?.tmdbid || '';
  }

  function getRequestProcessingKey(request) {
    const mediaType = getRequestMediaType(request);
    const tmdbId = getRequestTmdbId(request);
    return request?.id ? 'request:' + request.id : 'media:' + mediaType + ':' + tmdbId;
  }

  function getRequestTitle(request) {
    const media = getRequestMedia(request);
    return media?.title
      || media?.name
      || request?.media?.title
      || request?.media?.name
      || request?.title
      || 'Requested media';
  }

  function getRequestYear(request) {
    const media = getRequestMedia(request);
    return String(media?.releaseDate || media?.firstAirDate || media?.release_date || media?.first_air_date || '').slice(0, 4);
  }

  function getRequestPoster(request) {
    const media = getRequestMedia(request);
    return posterUrl(media?.posterPath || media?.poster_path || request?.posterPath || request?.poster_path);
  }

  function isComingSoonRequest(request) {
    const media = getRequestMedia(request);
    const mediaStatus = normalizeStatusValue(media?.status ?? media?.status4k);
    const requestStatus = normalizeStatusValue(request?.status);
    const downloadStatus = findStatusText(request, /processing|downloading|download|queued|queue|paused|grabbed|partial/i);

    if ([Status.AVAILABLE, 'available'].includes(mediaStatus)) return false;
    if ([Status.PENDING, Status.PROCESSING, Status.PARTIAL].includes(mediaStatus)) return true;
    if (downloadStatus) return true;
    if (['processing', 'downloading', 'partial'].includes(requestStatus)) return true;

    return false;
  }

  function normalizeStatusValue(value) {
    if (value == null) return null;
    if (Number.isFinite(Number(value))) return Number(value);
    return String(value).trim().toLowerCase();
  }

  function findStatusText(value, pattern, seen = new Set()) {
    if (value == null || seen.has(value)) return false;
    if (typeof value === 'string') return pattern.test(value);
    if (typeof value !== 'object') return false;
    seen.add(value);

    if (Array.isArray(value)) {
      return value.some(item => findStatusText(item, pattern, seen));
    }

    return Object.keys(value)
      .filter(key => /status|download|state|profile|approval/i.test(key))
      .some(key => findStatusText(value[key], pattern, seen));
  }

  function findYouTubeTrailer(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      const official = value.find(item => /trailer/i.test(item?.type || item?.name || '') && /youtube/i.test(item?.site || ''));
      if (official?.key) return 'https://www.youtube.com/watch?v=' + encodeURIComponent(official.key);
      for (const item of value) {
        const found = findYouTubeTrailer(item, seen);
        if (found) return found;
      }
      return null;
    }

    const site = String(value.site || value.provider || '').toLowerCase();
    if (site === 'youtube' && value.key) {
      return 'https://www.youtube.com/watch?v=' + encodeURIComponent(value.key);
    }
    if (typeof value.url === 'string' && /youtube\.com|youtu\.be/i.test(value.url)) return value.url;

    for (const key of Object.keys(value)) {
      const found = findYouTubeTrailer(value[key], seen);
      if (found) return found;
    }
    return null;
  }

  async function buildComingSoonItem(request) {
    const mediaType = getRequestMediaType(request);
    const tmdbId = getRequestTmdbId(request);
    const details = await seerrMediaDetails(mediaType, tmdbId);
    const media = getRequestMedia(request);
    const title = normalizeTitle(details) !== 'Unknown' ? normalizeTitle(details) : getRequestTitle(request);
    const poster = normalizePoster(details, 'w342')
      || getRequestPoster(request)
      || posterUrl(media?.posterPath || media?.poster_path);

    return {
      key: getRequestProcessingKey(request),
      title: title,
      year: normalizeYear(details) || getRequestYear(request),
      mediaType: mediaType,
      poster: poster
    };
  }

  async function pollProcessingRequests() {
    if (!getToken()) {
      setTimeout(pollProcessingRequests, 1000);
      return;
    }

    let requests = [];
    try {
      requests = await seerrComingSoonRequests();
    } catch {
      setTimeout(pollProcessingRequests, 3000);
      return;
    }

    if (!requests.length) {
      comingSoonItems = [];
      scheduleComingSoonHomeRenderAttempts();
      return;
    }

    comingSoonItems = await Promise.all(requests.map(buildComingSoonItem));
    scheduleComingSoonHomeRenderAttempts();
  }

  function startProcessingRequestPolling() {
    clearInterval(processingRequestPollTimer);
    pollProcessingRequests();
    processingRequestPollTimer = setInterval(pollProcessingRequests, PROCESSING_REQUEST_POLL_MS);
  }

  function isVisiblePageCandidate(element) {
    if (!(element instanceof HTMLElement) || element.closest('#js-seerr-discover')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getHomeContainerFromPage(page) {
    return page.querySelector('.homeSections')
      || page.querySelector('.content-primary')
      || page.querySelector('.sections')
      || page;
  }

  function scoreHomePageCandidate(page, index) {
    const text = (page.textContent || '').slice(0, 4000);
    const idClass = [page.id, page.className].join(' ');
    let score = index;

    if (/home/i.test(idClass)) score += 1000;
    if (/my media|libraries|next up|recently added|latest/i.test(text)) score += 500;
    if (/hide|hidden|inactive/i.test(idClass)) score -= 1000;

    const rect = page.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) score += 100;
    return score;
  }

  function getHomeContentContainer() {
    const pages = Array.from(document.querySelectorAll('.homePage, .mainAnimatedPages .page, .page, [data-role="page"]'))
      .filter(isVisiblePageCandidate);

    const scored = pages
      .map((page, index) => ({ page, score: scoreHomePageCandidate(page, index) }))
      .filter(item => item.score > -500)
      .sort((a, b) => b.score - a.score);

    if (scored.length) {
      return getHomeContainerFromPage(scored[0].page);
    }

    const fallback = document.querySelector('.skinBody .mainAnimatedPages')
      || document.querySelector('.mainAnimatedPages');
    return fallback instanceof HTMLElement ? fallback : null;
  }

  function getHomeSections(container) {
    return Array.from(container.children)
      .filter(child => child instanceof HTMLElement && child.id !== 'js-seerr-coming-soon');
  }

  function getSectionText(section) {
    const heading = section.querySelector?.('h1,h2,h3,.sectionTitle,.emby-section-title,[class*="sectionTitle"],[class*="SectionTitle"]');
    return ((heading?.textContent || section.textContent || '')).trim();
  }

  function findHomeSection(container, pattern) {
    return getHomeSections(container).find(section => pattern.test(getSectionText(section))) || null;
  }

  function getComingSoonPlacement(container) {
    const sections = getHomeSections(container);

    if (comingSoonPosition === 'bottom') {
      return { ready: true, before: null };
    }

    // Use getHomeSections (which excludes #js-seerr-coming-soon) so the anchor is
    // never the Coming Soon element itself. Otherwise isComingSoonPlaced can keep
    // returning false and trigger repeated observer/render work.
    if (comingSoonPosition === 'after-my-media') {
      const idx = sections.findIndex(s => /my media|libraries/i.test(getSectionText(s)));
      const targetIndex = idx === -1 ? 0 : idx;
      return sections[targetIndex] ? { ready: true, before: sections[targetIndex + 1] || null } : { ready: false, before: null };
    }

    if (comingSoonPosition === 'after-recently-added') {
      const idx = sections.findIndex(s => /recently added|latest media|newly added/i.test(getSectionText(s)));
      return idx === -1 ? { ready: true, before: null } : { ready: true, before: sections[idx + 1] || null };
    }

    return { ready: true, before: sections[0] || null };
  }

  function isComingSoonPlaced(container, section, placement) {
    if (section.parentElement !== container) return false;
    // Use nextElementSibling (skips text nodes) consistent with how sections are
    // computed by getHomeSections.
    if (placement.before === null) return section === container.lastElementChild;
    return section.nextElementSibling === placement.before;
  }

  function placeComingSoonSection(container, section) {
    const placement = getComingSoonPlacement(container);
    if (!placement.ready) return false;
    container.insertBefore(section, placement.before);
    return true;
  }

  function renderComingSoonCard(item) {
    const meta = [(item.year || ''), item.mediaType === 'tv' ? 'TV Show' : 'Movie']
      .filter(Boolean)
      .join(' · ');

    return [
      '<article class="js-seerr-comingSoonCard">',
      '  <div class="js-seerr-comingSoonPosterWrap">',
      item.poster
        ? '    <img class="js-seerr-comingSoonPoster" src="' + escHtml(item.poster) + '" alt="' + escHtml(item.title) + '" loading="lazy" />'
        : '    <span class="js-seerr-comingSoonPosterFallback">' + escHtml(item.title) + '</span>',
      '    <span class="js-seerr-comingSoonBadge">Coming Soon</span>',
      '  </div>',
      '  <div class="js-seerr-comingSoonName">' + escHtml(item.title) + '</div>',
      meta ? '  <div class="js-seerr-comingSoonMeta">' + escHtml(meta) + '</div>' : '',
      '</article>'
    ].join('');
  }

  function bindComingSoonSection(section) {
    const row = section.querySelector('.js-seerr-comingSoonRow');
    if (row && row.dataset.jsSeerrSwipeBound !== 'true') {
      row.dataset.jsSeerrSwipeBound = 'true';
      ['touchstart', 'touchmove', 'wheel'].forEach(type => {
        row.addEventListener(type, event => event.stopPropagation(), { passive: true });
      });
    }
  }

  function renderComingSoonSection() {
    const existing = document.getElementById('js-seerr-coming-soon');
    if (!comingSoonConfigLoaded || !isHomeRoute() || !comingSoonItems.length || comingSoonPosition === 'disabled') {
      existing?.remove();
      return;
    }

    const container = getHomeContentContainer();
    if (!container) {
      return;
    }

    const section = existing || document.createElement('section');
    const placement = getComingSoonPlacement(container);
    if (!placement.ready) {
      existing?.remove();
      return;
    }

    const signature = [
      comingSoonPosition,
      comingSoonItems.map(item => item.key + ':' + item.title + ':' + (item.poster || '')).join('|')
    ].join('::');
    if (existing?.dataset.signature === signature && isComingSoonPlaced(container, existing, placement)) return;

    section.id = 'js-seerr-coming-soon';
    section.className = 'js-seerr-comingSoonSection';
    section.dataset.signature = signature;
    section.innerHTML = [
      '<div class="js-seerr-comingSoonHeader sectionTitleContainer">',
      '  <h2 class="js-seerr-comingSoonTitle sectionTitle">Coming Soon</h2>',
      '</div>',
      '<div class="js-seerr-comingSoonRow">',
      comingSoonItems.map(renderComingSoonCard).join(''),
      '</div>'
    ].join('');

    if (!placeComingSoonSection(container, section)) {
      return;
    }
    bindComingSoonSection(section);
  }

  function getItemDisplayName(item) {
    return item?.Name || item?.OriginalTitle || item?.SortName || 'New item';
  }

  function isRecentlyCreated(item) {
    const created = Date.parse(item?.DateCreated || '');
    return Number.isFinite(created) && Date.now() - created <= INITIAL_RECENT_TOAST_MS;
  }

  function removeTrackedRequestsForLibraryItems(items) {
    const availableKeys = new Set(items
      .map(item => {
        const tmdbId = item?.ProviderIds?.Tmdb;
        if (!tmdbId) return null;
        const mediaType = item.Type === 'Series' ? 'tv' : 'movie';
        return mediaType + ':' + tmdbId;
      })
      .filter(Boolean));

    if (!availableKeys.size) return;

    const tracked = loadTrackedRequests();
    const nextTracked = tracked.filter(item => !availableKeys.has(item.mediaType + ':' + item.mediaId));
    if (nextTracked.length !== tracked.length) {
      saveTrackedRequests(nextTracked);
    }
  }

  async function pollLatestLibraryItems() {
    const items = await jellyfinLatestLibraryItems();
    if (!items.length) return;

    const ids = items.map(item => String(item.Id)).filter(Boolean);
    const known = loadKnownLatestItems();

    if (known === null) {
      saveKnownLatestItems(ids);
      if (isPlaybackRoute()) return;

      const recentItems = items.filter(isRecentlyCreated);
      removeTrackedRequestsForLibraryItems(recentItems);
      recentItems
        .reverse()
        .forEach(item => showToast('Available in Jellyfin', getItemDisplayName(item) + ' was added to your library.'));
      return;
    }

    const knownSet = new Set(known);
    const newItems = items.filter(item => item?.Id && !knownSet.has(String(item.Id)));
    if (!newItems.length) {
      saveKnownLatestItems([...ids, ...known.filter(id => !ids.includes(id))]);
      return;
    }

    if (isPlaybackRoute()) return;

    removeTrackedRequestsForLibraryItems(newItems);
    newItems
      .reverse()
      .forEach(item => showToast('Available in Jellyfin', getItemDisplayName(item) + ' was added to your library.'));

    saveKnownLatestItems([...ids, ...known.filter(id => !ids.includes(id))]);
  }

  function startLatestLibraryPolling() {
    clearInterval(latestLibraryPollTimer);
    pollLatestLibraryItems();
    latestLibraryPollTimer = setInterval(pollLatestLibraryItems, LATEST_LIBRARY_POLL_MS);
  }

  function setConfigStatus(view, msg, ok) {
    const el = view.querySelector('#statusMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#4caf50' : '#e53935';
  }

  async function loadConfigPage(view) {
    try {
      const cfg = await window.ApiClient.getPluginConfiguration(GUID);
      const urlInput = view.querySelector('#txtSeerrUrl');
      const keyInput = view.querySelector('#txtSeerrApiKey');
      const comingSoonPositionInput = view.querySelector('#selectComingSoonPosition');
      if (urlInput) urlInput.value = cfg.SeerrUrl || '';
      if (keyInput) keyInput.value = cfg.SeerrApiKey || '';
      if (comingSoonPositionInput) {
        comingSoonPositionInput.value = normalizeComingSoonPosition(cfg.ComingSoonPosition || 'top');
      }
      comingSoonPosition = normalizeComingSoonPosition(cfg.ComingSoonPosition || 'top');
      comingSoonConfigLoaded = true;
      queueComingSoonRender();
      setConfigStatus(view, '', true);
    } catch {
      setConfigStatus(view, 'Could not load plugin settings', false);
    }
  }

  function bindConfigPage(view) {
    if (!view || view.dataset.jsConfigBound === 'true') return;

    const form = view.querySelector('#jellySeerrConfigForm');
    const saveBtn = view.querySelector('#btnSave');
    const testBtn = view.querySelector('#btnTest');
    const testToastBtn = view.querySelector('#btnTestToast');
    const urlInput = view.querySelector('#txtSeerrUrl');
    const keyInput = view.querySelector('#txtSeerrApiKey');
    const comingSoonPositionInput = view.querySelector('#selectComingSoonPosition');

    if (!form || !saveBtn || !testBtn || !testToastBtn || !urlInput || !keyInput || !comingSoonPositionInput) return;

    view.dataset.jsConfigBound = 'true';

    form.addEventListener('submit', async evt => {
      evt.preventDefault();
      saveBtn.disabled = true;
      setConfigStatus(view, 'Saving...', true);

      try {
        const cfg = await window.ApiClient.getPluginConfiguration(GUID);
        cfg.SeerrUrl = urlInput.value.trim();
        cfg.SeerrApiKey = keyInput.value.trim();
        cfg.ComingSoonPosition = normalizeComingSoonPosition(comingSoonPositionInput.value);
        await window.ApiClient.updatePluginConfiguration(GUID, cfg);
        comingSoonPosition = cfg.ComingSoonPosition;
        comingSoonConfigLoaded = true;
        queueComingSoonRender();
        setConfigStatus(view, 'Saved', true);
      } catch {
        setConfigStatus(view, 'Save failed', false);
      } finally {
        saveBtn.disabled = false;
      }
    });

    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      setConfigStatus(view, 'Testing...', true);

      try {
        const resp = await fetch(API + '/Status/movie/550', {
          headers: { 'X-MediaBrowser-Token': window.ApiClient.accessToken() }
        });

        if (resp.ok) {
          setConfigStatus(view, 'Connection OK', true);
        } else {
          setConfigStatus(view, 'Error ' + resp.status, false);
        }
      } catch {
        setConfigStatus(view, 'Could not reach Seerr', false);
      } finally {
        testBtn.disabled = false;
      }
    });

    testToastBtn.addEventListener('click', () => {
      showTestToast();
      setConfigStatus(view, 'Notification test shown', true);
    });

    loadConfigPage(view);
  }

  function initConfigPage() {
    bindConfigPage(document.getElementById('jellySeerrConfigPage'));
  }

  function btnStyle(color) {
    return [
      'margin:4px 8px 4px 0', 'padding:7px 18px',
      'border:none', 'border-radius:4px',
      'background:' + color, 'color:#fff',
      'font-size:13px', 'font-weight:600',
      'cursor:pointer', 'vertical-align:middle',
      'transition:opacity .15s'
    ].join(';');
  }

  function findDetailContainer() {
    const selectors = [
      '.detailButtons',
      '.itemDetailButtons',
      '[class*="detailButton"]',
      '[class*="DetailButton"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    const known = ['Play', 'Shuffle', 'Trailer', 'More'].map(t =>
      document.querySelector('button[title="' + t + '"]')
    ).find(Boolean);
    return known ? known.parentElement : null;
  }

  async function injectDetailButton() {
    if (!isDetailPage() || isDiscoverRoute()) return;

    const itemId = getItemId();
    if (!itemId) return;

    if (itemId !== lastDetailId) {
      document.getElementById('js-request-btn')?.remove();
    }
    if (document.getElementById('js-request-btn')) return;

    const container = findDetailContainer();
    if (!container) {
      retryTimer = setTimeout(injectDetailButton, 600);
      return;
    }

    lastDetailId = itemId;
    const item = await getJellyfinItem(itemId);
    if (!item?.ProviderIds?.Tmdb) return;
    if (!['Movie', 'Series'].includes(item.Type)) return;

    const mediaType = item.Type === 'Series' ? 'tv' : 'movie';
    const tmdbId = item.ProviderIds.Tmdb;
    const data = await seerrStatus(mediaType, tmdbId);
    const info = statusInfo(data?.mediaInfo?.status, mediaType);

    if (data?.mediaInfo?.status === Status.AVAILABLE) {
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'js-request-btn';
    btn.textContent = '...';
    btn.disabled = true;
    btn.style.cssText = btnStyle('#555');
    container.appendChild(btn);

    btn.textContent = info.label;
    btn.style.cssText = btnStyle(info.color);
    btn.disabled = info.disabled;

    if (!info.disabled) {
      btn.addEventListener('click', async () => {
        const currentData = await seerrStatus(mediaType, tmdbId) || data;
        const result = await submitRequest(btn, mediaType, tmdbId, currentData);
        if (result === false) {
          const reset = statusInfo(currentData?.mediaInfo?.status, mediaType);
          btn.textContent = reset.label;
          btn.style.cssText = btnStyle(reset.color);
          btn.disabled = reset.disabled;
          return;
        }

        const refreshed = await seerrStatus(mediaType, tmdbId);
        if (!refreshed) {
          btn.textContent = 'Failed - retry';
          btn.style.cssText = btnStyle('#e53935');
          btn.disabled = false;
          return;
        }

        const done = statusInfo(refreshed?.mediaInfo?.status, mediaType);
        btn.textContent = done.label;
        btn.style.cssText = btnStyle(done.color);
        btn.disabled = done.disabled;
        if (refreshed?.mediaInfo?.status !== Status.AVAILABLE) {
          trackRequestedItem(mediaType, Number(tmdbId), item.Name || 'Requested item');
        }
      });
    }
  }

  function getDrawerContainer() {
    return document.querySelector('.mainDrawer .scrollContainer')
      || document.querySelector('.mainDrawer .drawerContent')
      || document.querySelector('.mainDrawer');
  }

  function getBrowseButtonContainer() {
    const candidates = Array.from(document.querySelectorAll('button,a'))
      .filter(el => /^(Home|Favorites|Favourites)$/i.test((el.textContent || '').trim()))
      .map(el => el.parentElement)
      .filter(Boolean);

    return candidates.find(container => {
      if (container.closest('.mainDrawer') || container.closest('#js-seerr-discover')) {
        return false;
      }

      const labels = Array.from(container.children).map(el => (el.textContent || '').trim());
      const hasHome = labels.some(text => /^Home$/i.test(text));
      const hasFavorites = labels.some(text => /^(Favorites|Favourites)$/i.test(text));
      return hasHome && hasFavorites;
    }) || null;
  }

  function getBrowseAnchorButton() {
    const container = getBrowseButtonContainer();
    if (!container) return null;

    return Array.from(container.children).find(el => {
      const text = (el.textContent || '').trim();
      return /^(Home|Favorites|Favourites)$/i.test(text);
    }) || null;
  }

  function bindBrowseAnchorButtons() {
    const container = getBrowseButtonContainer();
    if (!container || container.dataset.jsSeerrBound === 'true') return;

    container.dataset.jsSeerrBound = 'true';
    Array.from(container.children).forEach(button => {
      const text = (button.textContent || '').trim();
      if (!/^(Home|Favorites|Favourites)$/i.test(text)) return;

      button.addEventListener('click', event => {
        if (!isDiscoverRoute() || suppressBrowseAnchorRedirect) return;

        event.preventDefault();
        event.stopPropagation();

        const targetLabel = text;
        const targetHash = /^Home$/i.test(targetLabel) ? '#/home.html' : getRouteHrefWithoutDiscover();
        window.location.hash = targetHash;

        setTimeout(() => {
          const restoredContainer = getBrowseButtonContainer();
          const restoredButton = restoredContainer
            ? Array.from(restoredContainer.children).find(el => ((el.textContent || '').trim() === targetLabel))
            : null;

          if (restoredButton) {
            suppressBrowseAnchorRedirect = true;
            restoredButton.click();
            setTimeout(() => { suppressBrowseAnchorRedirect = false; }, 0);
          }
        }, 80);
      });
    });
  }

  function getDiscoverHost() {
    return document.querySelector('.skinBody .mainAnimatedPages')
      || document.querySelector('.mainAnimatedPages')
      || document.querySelector('.viewContainer')
      || null;
  }

  function setDiscoverHostVisibility(host, active) {
    Array.from(host.children).forEach(child => {
      if (child.id === 'js-seerr-discover') {
        child.style.display = active ? '' : 'none';
        return;
      }

      if (active) {
        if (!child.hasAttribute('data-js-seerr-prev-display')) {
          child.setAttribute('data-js-seerr-prev-display', child.style.display || '');
        }
        child.style.display = 'none';
      } else if (child.hasAttribute('data-js-seerr-prev-display')) {
        child.style.display = child.getAttribute('data-js-seerr-prev-display') || '';
        child.removeAttribute('data-js-seerr-prev-display');
      }
    });
  }

  function injectDiscoverMenuLink() {
    const drawer = getDrawerContainer();
    if (!drawer || document.getElementById('js-seerr-nav')) return;

    const link = document.createElement('a');
    link.id = 'js-seerr-nav';
    link.href = DISCOVER_ROUTE;
    link.className = 'navMenuOption lnkJellySeerrDiscover';
    link.innerHTML = [
      '<span class="material-icons navMenuOptionIcon" aria-hidden="true">explore</span>',
      '<span class="navMenuOptionText">Discover</span>'
    ].join('');

    const navItems = Array.from(drawer.querySelectorAll('.navMenuOption'));
    const homeLink = navItems.find(item => /home/i.test(item.getAttribute('href') || '') || /home/i.test(item.textContent || ''));
    const anchorTarget = homeLink || navItems[0] || null;
    if (anchorTarget?.parentElement) {
      anchorTarget.parentElement.insertBefore(link, anchorTarget.nextSibling);
    } else {
      drawer.appendChild(link);
    }
  }

  function injectBrowseDiscoverButton() {
    if (document.getElementById('js-seerr-browse-btn')) return;

    const template = getBrowseAnchorButton();
    const container = getBrowseButtonContainer();
    if (!template || !container) return;

    const button = document.createElement('button');
    button.id = 'js-seerr-browse-btn';
    button.type = 'button';
    button.title = 'Discover';
    button.setAttribute('aria-label', 'Discover');
    button.className = Array.from(template.classList)
      .filter(name => name && !/active|selected|home|favorite|favourite/i.test(name))
      .join(' ');
    if (!button.className.trim()) {
      button.className = 'emby-tab-button emby-button';
    }
    button.innerHTML = '<span class="material-icons" aria-hidden="true">explore</span><span>Discover</span>';
    button.classList.remove('button-submit');
    button.classList.remove('selected');
    button.classList.remove('navMenuOption-selected');
    button.classList.remove('emby-tab-button-active');
    button.addEventListener('click', event => {
      event.preventDefault();
      window.location.hash = DISCOVER_ROUTE;
    });

    const favoritesBtn = Array.from(container.children).find(el => /favorites|favourites/i.test((el.textContent || '').trim()));
    if (favoritesBtn) {
      container.insertBefore(button, favoritesBtn.nextSibling);
    } else {
      container.appendChild(button);
    }
  }

  function updateBrowseButtonStates(activeDiscover) {
    const container = getBrowseButtonContainer();
    const browseButton = document.getElementById('js-seerr-browse-btn');
    if (!container || !browseButton) return;

    Array.from(container.children).forEach(button => {
      if (!(button instanceof HTMLElement)) return;

      const text = (button.textContent || '').trim();
      const isNativeBrowseButton = /^(Home|Favorites|Favourites)$/i.test(text);

      if (button === browseButton) {
        button.classList.toggle('emby-tab-button-active', activeDiscover);
        button.classList.remove('button-submit');
        button.classList.remove('selected');
        if (activeDiscover) {
          button.setAttribute('aria-current', 'page');
        } else {
          button.removeAttribute('aria-current');
        }
        return;
      }

      if (!isNativeBrowseButton) return;

      if (activeDiscover) {
        button.classList.remove('emby-tab-button-active');
        button.classList.remove('selected');
        button.removeAttribute('aria-current');
      }
    });
  }

  function updateDiscoverMenuState() {
    const activeDiscover = isDiscoverRoute();
    const link = document.getElementById('js-seerr-nav');
    if (link) {
      if (activeDiscover) {
        link.classList.add('navMenuOption-selected');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('navMenuOption-selected');
        link.removeAttribute('aria-current');
      }
    }

    const browseButton = document.getElementById('js-seerr-browse-btn');
    if (browseButton) {
      updateBrowseButtonStates(activeDiscover);
    }
  }

  function refreshHomeAfterDiscoverExit() {
    clearTimeout(discoverExitRefreshTimer);
    discoverExitRefreshTimer = setTimeout(() => {
      if (!isHomeRoute() || isDiscoverRoute()) return;

      const homeButton = findBrowseButton(/^Home$/i);
      if (homeButton) {
        suppressBrowseAnchorRedirect = true;
        homeButton.click();
        setTimeout(() => { suppressBrowseAnchorRedirect = false; }, 0);
      }

      pollProcessingRequests();
      scheduleComingSoonRenderAfterHomeRemount();
    }, 80);
  }

  function scheduleComingSoonRenderAfterHomeRemount() {
    scheduleComingSoonHomeRenderAttempts(true);
  }

  function applyDiscoverRequestState(button, mediaType, data) {
    const info = statusInfo(data?.mediaInfo?.status, mediaType);
    button.textContent = info.label;
    button.style.background = info.color;
    button.disabled = info.disabled;
  }

  function updateDiscoverRequestButtons(mediaType, mediaId, data) {
    Array.from(document.querySelectorAll('[data-request-id]')).forEach(button => {
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.getAttribute('data-request-media') !== mediaType) return;
      if (Number(button.getAttribute('data-request-id')) !== Number(mediaId)) return;
      applyDiscoverRequestState(button, mediaType, data);
    });
  }

  function handleRouteChange() {
    const homeActive = isHomeRoute() && !isDiscoverRoute();
    const enteredHome = homeActive && !lastWasHomeRoute;
    lastWasHomeRoute = homeActive;

    if (!comingSoonConfigLoaded && !comingSoonConfigLoading) {
      loadPluginRuntimeConfig();
    }
    rememberNonDiscoverRoute();
    injectDiscoverMenuLink();
    injectBrowseDiscoverButton();
    bindBrowseAnchorButtons();
    updateDiscoverMenuState();
    ensureDiscoverPage();
    if (homeActive) {
      const container = getHomeContentContainer();
      const section = document.getElementById('js-seerr-coming-soon');
      const needsFreshAttempts = enteredHome || !section || !container || section.parentElement !== container;
      queueComingSoonRender(0, true);
      scheduleComingSoonHomeRenderAttempts(needsFreshAttempts);
    } else {
      queueComingSoonRender();
    }
  }

  async function loadDiscoverSections() {
    if (discoverPageLoading) return;
    discoverPageLoading = true;
    discoverState.loadError = '';
    renderDiscoverPage();

    const [trending, movies, tv, upcomingMovies, upcomingTv] = await Promise.all([
      seerrDiscover('trending'),
      seerrDiscover('movies'),
      seerrDiscover('tv'),
      seerrDiscover('upcoming-movies'),
      seerrDiscover('upcoming-tv')
    ]);

    discoverState.sections = {
      trending: trending?.results || [],
      movies: movies?.results || [],
      tv: tv?.results || [],
      upcomingMovies: upcomingMovies?.results || [],
      upcomingTv: upcomingTv?.results || []
    };
    if (!trending && !movies && !tv && !upcomingMovies && !upcomingTv) {
      discoverState.loadError = 'Could not load Discover content from Seerr. You can still search below.';
    }
    discoverPageLoading = false;
    renderDiscoverPage();
  }

  async function loadDiscoverSearch() {
    const query = discoverState.query.trim();
    if (!query) {
      discoverState.loadingSearch = false;
      discoverState.searchResults = null;
      renderDiscoverPage();
      return;
    }

    discoverState.loadingSearch = true;
    renderDiscoverPage();
    const data = await seerrSearch(query);
    discoverState.searchResults = data?.results || [];
    discoverState.loadingSearch = false;
    renderDiscoverPage();
  }

  function ensureDiscoverPage() {
    if (!isDiscoverRoute()) {
      const existing = document.getElementById('js-seerr-discover');
      const wasDiscoverActive = Boolean(existing) || discoverMounted;
      const host = existing?.parentElement;
      if (host) {
        setDiscoverHostVisibility(host, false);
      }
      existing?.remove();
      discoverMounted = false;
      if (wasDiscoverActive && isHomeRoute()) {
        refreshHomeAfterDiscoverExit();
      }
      return;
    }

    const host = getDiscoverHost();
    if (!host) return;
    if (host !== document.body && !host.style.position) {
      host.style.position = 'relative';
    }

    let page = document.getElementById('js-seerr-discover');
    if (!page) {
      page = document.createElement('div');
      page.id = 'js-seerr-discover';
      page.className = 'page type-interior';
      host.appendChild(page);
      discoverMounted = false;
    } else if (page.parentElement !== host) {
      host.appendChild(page);
    }

    setDiscoverHostVisibility(host, true);

    if (!discoverMounted) {
      renderDiscoverPage();
      discoverMounted = true;
    }

    if (!discoverState.sections && !discoverPageLoading) {
      loadDiscoverSections();
    }
  }

  function renderDiscoverSection(title, items) {
    if (!items?.length) return '';

    const cards = items.map(item => renderDiscoverCard(item)).join('');
    return [
      '<section class="js-seerr-section">',
      '  <div class="js-seerr-sectionHeader">',
      '    <h2 class="js-seerr-sectionTitle">' + escHtml(title) + '</h2>',
      '  </div>',
      '  <div class="js-seerr-row">' + cards + '</div>',
      '</section>'
    ].join('');
  }

  function renderDiscoverCard(item) {
    const mediaType = normalizeMediaType(item);
    const title = normalizeTitle(item);
    const year = normalizeYear(item);
    const poster = normalizePoster(item, 'w342');
    const info = statusInfo(item?.mediaInfo?.status, mediaType);

    return [
      '<article class="js-seerr-card">',
      poster
        ? '<img class="js-seerr-poster" src="' + poster + '" alt="' + escHtml(title) + '" />'
        : '<div class="js-seerr-poster"></div>',
      '<div>',
      '  <div class="js-seerr-cardTitle">' + escHtml(title) + '</div>',
      '  <div class="js-seerr-cardMeta">' + escHtml((year ? year + ' · ' : '') + (mediaType === 'tv' ? 'TV Show' : 'Movie')) + '</div>',
      '  <button class="js-seerr-requestButton" type="button" data-request-title="' + escHtml(title) + '" data-request-media="' + escHtml(mediaType) + '" data-request-id="' + item.id + '" style="background:' + info.color + '"' + (info.disabled ? ' disabled' : '') + '>',
      escHtml(info.label),
      '  </button>',
      '</div>',
      '</article>'
    ].join('');
  }

  function renderSearchResults(items) {
    if (discoverState.loadingSearch) {
      return '<div class="js-seerr-status">Searching Seerr...</div>';
    }

    if (!items?.length) {
      return '<div class="js-seerr-status">No results found.</div>';
    }

    return [
      '<section class="js-seerr-section">',
      '  <div class="js-seerr-grid">',
      items.map(item => renderDiscoverCard(item)).join(''),
      '  </div>',
      '</section>'
    ].join('');
  }

  function renderDiscoverBody() {
    if (discoverState.query.trim()) {
      return renderSearchResults(discoverState.searchResults);
    }

    if (discoverPageLoading && !discoverState.sections) {
      return '<div class="js-seerr-status">Loading Discover...</div>';
    }

    if (discoverState.loadError) {
      return '<div class="js-seerr-status">' + escHtml(discoverState.loadError) + '</div>';
    }

    const sections = discoverState.sections || {};
    const hasAnyItems = Object.values(sections).some(items => Array.isArray(items) && items.length);
    if (!hasAnyItems) {
      return '<div class="js-seerr-status">No Discover rows are available right now. Use search above to request something directly.</div>';
    }

    return [
      renderDiscoverSection('Trending', sections.trending),
      renderDiscoverSection('Popular Movies', sections.movies),
      renderDiscoverSection('Popular TV', sections.tv),
      renderDiscoverSection('Upcoming Movies', sections.upcomingMovies),
      renderDiscoverSection('Upcoming TV', sections.upcomingTv)
    ].join('');
  }

  function bindDiscoverPage(page) {
    const search = page.querySelector('#js-seerr-discover-search');
    const refreshBtn = page.querySelector('#js-seerr-discover-refresh');

    if (search) {
      search.value = discoverState.query;
      search.addEventListener('input', event => {
        discoverState.query = event.target.value;
        clearTimeout(discoverSearchTimer);
        discoverSearchTimer = setTimeout(loadDiscoverSearch, 300);
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        discoverState.sections = null;
        if (discoverState.query.trim()) {
          await loadDiscoverSearch();
        } else {
          await loadDiscoverSections();
        }
      });
    }

    Array.from(page.querySelectorAll('[data-request-id]')).forEach(button => {
      if (button.disabled) return;
      button.addEventListener('click', async () => {
        if (discoverRequestInFlight) return;
        discoverRequestInFlight = true;
        const mediaType = button.getAttribute('data-request-media');
        const mediaId = Number(button.getAttribute('data-request-id'));
        const title = button.getAttribute('data-request-title') || 'Requested item';
        const data = await seerrStatus(mediaType, mediaId);

        if (!data) {
          button.textContent = 'Failed';
          button.style.background = '#e53935';
          button.disabled = false;
          discoverRequestInFlight = false;
          return;
        }

        const result = await submitRequest(button, mediaType, mediaId, data);
        if (result) {
          trackRequestedItem(mediaType, mediaId, title);
          const refreshed = await seerrStatus(mediaType, mediaId);
          if (refreshed) {
            updateDiscoverRequestButtons(mediaType, mediaId, refreshed);
          } else {
            button.textContent = 'Failed - retry';
            button.style.background = '#e53935';
            button.disabled = false;
          }
        } else {
          const reset = statusInfo(data?.mediaInfo?.status, mediaType);
          button.textContent = reset.label;
          button.style.background = reset.color;
          button.disabled = reset.disabled;
        }

        discoverRequestInFlight = false;
      });
    });
  }

  function renderDiscoverPage() {
    const page = document.getElementById('js-seerr-discover');
    if (!page) return;

    page.innerHTML = [
      '<div class="content-primary">',
      '  <div class="js-seerr-hero">',
      '    <h1 class="js-seerr-title sectionTitle">Discover</h1>',
      '    <div class="js-seerr-actions">',
      '      <button id="js-seerr-discover-refresh" class="raised emby-button js-seerr-pill" type="button">Refresh</button>',
      '    </div>',
      '  </div>',
      '  <div class="js-seerr-searchbar">',
      '    <input id="js-seerr-discover-search" class="emby-input" type="search" placeholder="Search Seerr for movies and TV shows..." autocomplete="off" />',
      '  </div>',
      renderDiscoverBody(),
      '</div>'
    ].join('');

    bindDiscoverPage(page);
    discoverMounted = true;
  }

  const observer = new MutationObserver(() => {
    const href = window.location.href;

    initConfigPage();
    handleRouteChange();

    if (href !== lastHref) {
      lastHref = href;
      lastDetailId = null;
      clearTimeout(retryTimer);
      if (isDetailPage()) retryTimer = setTimeout(injectDetailButton, 800);
    } else if (isDetailPage() && !document.getElementById('js-request-btn')) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(injectDetailButton, 600);
    }
  });

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function init() {
    if (!document.body) {
      setTimeout(init, 100);
      return;
    }

    ensurePluginStyles();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', handleRouteChange);
    document.addEventListener('viewshow', event => {
      if (event.target && event.target.id === 'jellySeerrConfigPage') {
        bindConfigPage(event.target);
        loadConfigPage(event.target);
      }
    });

    initConfigPage();
    handleRouteChange();
    loadPluginRuntimeConfig();
    startRequestPolling();
    startProcessingRequestPolling();
    startLatestLibraryPolling();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        pollTrackedRequests();
        pollProcessingRequests();
        pollLatestLibraryItems();
      }
    });
    if (isDetailPage()) setTimeout(injectDetailButton, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
