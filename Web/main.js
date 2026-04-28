(function () {
  'use strict';

  const GUID = '3b4f8e2a-7c91-4d05-b3e6-1a2f9c847d30';
  const API = '/plugins/JellySeerr';
  const DISCOVER_ROUTE = '#/home.html?jellyseerr=discover';
  const Status = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIAL: 4, AVAILABLE: 5 };

  let lastHref = '';
  let lastDetailId = null;
  let retryTimer = null;
  let discoverSearchTimer = null;
  let discoverPageLoading = false;
  let discoverRequestInFlight = false;
  const discoverState = {
    sections: null,
    query: '',
    searchResults: null,
    loadingSearch: false
  };

  function getToken() {
    try {
      const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
      return creds.Servers?.[0]?.AccessToken || '';
    } catch { return ''; }
  }

  async function apiFetch(path, opts = {}) {
    const token = getToken();
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

  function getRouteHrefWithoutDiscover() {
    if (window.location.hash.startsWith('#/') && !isDiscoverRoute()) return window.location.hash;
    return '#/home.html';
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
      if (urlInput) urlInput.value = cfg.SeerrUrl || '';
      if (keyInput) keyInput.value = cfg.SeerrApiKey || '';
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
    const urlInput = view.querySelector('#txtSeerrUrl');
    const keyInput = view.querySelector('#txtSeerrApiKey');

    if (!form || !saveBtn || !testBtn || !urlInput || !keyInput) return;

    view.dataset.jsConfigBound = 'true';

    form.addEventListener('submit', async evt => {
      evt.preventDefault();
      saveBtn.disabled = true;
      setConfigStatus(view, 'Saving...', true);

      try {
        const cfg = await window.ApiClient.getPluginConfiguration(GUID);
        cfg.SeerrUrl = urlInput.value.trim();
        cfg.SeerrApiKey = keyInput.value.trim();
        await window.ApiClient.updatePluginConfiguration(GUID, cfg);
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

    const btn = document.createElement('button');
    btn.id = 'js-request-btn';
    btn.textContent = '...';
    btn.disabled = true;
    btn.style.cssText = btnStyle('#555');
    container.appendChild(btn);

    const data = await seerrStatus(mediaType, tmdbId);
    const info = statusInfo(data?.mediaInfo?.status, mediaType);
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
      });
    }
  }

  function getDrawerContainer() {
    return document.querySelector('.mainDrawer .scrollContainer')
      || document.querySelector('.mainDrawer .drawerContent')
      || document.querySelector('.mainDrawer');
  }

  function injectDiscoverMenuLink() {
    const drawer = getDrawerContainer();
    if (!drawer || document.getElementById('js-seerr-nav')) return;

    const link = document.createElement('a');
    link.id = 'js-seerr-nav';
    link.href = DISCOVER_ROUTE;
    link.className = 'navMenuOption lnkJellySeerrDiscover';
    link.style.cssText = 'display:flex;align-items:center;gap:1em;';
    link.innerHTML = [
      '<span class="material-icons navMenuOptionIcon" aria-hidden="true">explore</span>',
      '<span class="navMenuOptionText">Discover</span>'
    ].join('');

    const navItems = drawer.querySelectorAll('.navMenuOption');
    const anchorTarget = navItems.length ? navItems[navItems.length - 1] : null;
    if (anchorTarget?.parentElement) {
      anchorTarget.parentElement.insertBefore(link, anchorTarget.nextSibling);
    } else {
      drawer.appendChild(link);
    }
  }

  function updateDiscoverMenuState() {
    const link = document.getElementById('js-seerr-nav');
    if (!link) return;

    if (isDiscoverRoute()) {
      link.classList.add('navMenuOption-selected');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove('navMenuOption-selected');
      link.removeAttribute('aria-current');
    }
  }

  async function loadDiscoverSections() {
    if (discoverPageLoading) return;
    discoverPageLoading = true;
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
      document.getElementById('js-seerr-discover')?.remove();
      return;
    }

    let page = document.getElementById('js-seerr-discover');
    if (!page) {
      page = document.createElement('div');
      page.id = 'js-seerr-discover';
      page.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9998',
        'background:radial-gradient(circle at top, rgba(0,164,220,.16), transparent 28%), linear-gradient(180deg, rgba(12,12,12,.98), rgba(8,8,8,.98))',
        'overflow:auto', 'padding:72px 20px 28px', 'color:#fff'
      ].join(';');
      document.body.appendChild(page);
    }

    renderDiscoverPage();
    if (!discoverState.sections && !discoverPageLoading) {
      loadDiscoverSections();
    }
  }

  function renderDiscoverSection(title, items) {
    if (!items?.length) return '';

    const cards = items.map(item => renderDiscoverCard(item)).join('');
    return [
      '<section style="margin-top:28px">',
      '  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">',
      '    <h2 style="margin:0;font-size:22px;font-weight:700">' + escHtml(title) + '</h2>',
      '  </div>',
      '  <div style="display:flex;gap:14px;overflow-x:auto;padding-bottom:6px">' + cards + '</div>',
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
      '<article style="flex:0 0 180px;display:flex;flex-direction:column;gap:10px">',
      poster
        ? '<img src="' + poster + '" alt="' + escHtml(title) + '" style="width:180px;height:270px;object-fit:cover;border-radius:12px;background:#222" />'
        : '<div style="width:180px;height:270px;border-radius:12px;background:#222"></div>',
      '<div style="display:flex;flex-direction:column;gap:6px">',
      '  <div style="font-weight:700;font-size:15px;line-height:1.3">' + escHtml(title) + '</div>',
      '  <div style="font-size:12px;color:#aaa">' + escHtml((year ? year + ' · ' : '') + (mediaType === 'tv' ? 'TV Show' : 'Movie')) + '</div>',
      '  <button type="button" data-request-media="' + escHtml(mediaType) + '" data-request-id="' + item.id + '" style="margin-top:2px;padding:9px 12px;border:none;border-radius:8px;background:' + info.color + ';color:#fff;font-weight:600;cursor:pointer"' + (info.disabled ? ' disabled' : '') + '>',
      escHtml(info.label),
      '  </button>',
      '</div>',
      '</article>'
    ].join('');
  }

  function renderSearchResults(items) {
    if (discoverState.loadingSearch) {
      return '<div style="padding:32px 0;color:#aaa">Searching Seerr...</div>';
    }

    if (!items?.length) {
      return '<div style="padding:32px 0;color:#aaa">No results found.</div>';
    }

    return [
      '<section style="margin-top:24px">',
      '  <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:16px">',
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
      return '<div style="padding:32px 0;color:#aaa">Loading Discover...</div>';
    }

    const sections = discoverState.sections || {};
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
    const closeBtn = page.querySelector('#js-seerr-discover-close');
    const refreshBtn = page.querySelector('#js-seerr-discover-refresh');

    if (search) {
      search.value = discoverState.query;
      search.addEventListener('input', event => {
        discoverState.query = event.target.value;
        clearTimeout(discoverSearchTimer);
        discoverSearchTimer = setTimeout(loadDiscoverSearch, 300);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        window.location.hash = getRouteHrefWithoutDiscover();
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
          if (discoverState.query.trim()) {
            await loadDiscoverSearch();
          } else {
            await loadDiscoverSections();
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
      '<div style="width:min(1280px, calc(100% - 12px));margin:0 auto 0;display:flex;flex-direction:column;gap:10px">',
      '  <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">',
      '    <div>',
      '      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7bd6f2">JellySeerr</div>',
      '      <h1 style="margin:4px 0 0;font-size:38px;line-height:1.05">Discover</h1>',
      '    </div>',
      '    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">',
      '      <button id="js-seerr-discover-refresh" type="button" style="padding:10px 14px;border:none;border-radius:999px;background:#1f2b32;color:#fff;cursor:pointer">Refresh</button>',
      '      <button id="js-seerr-discover-close" type="button" style="padding:10px 14px;border:none;border-radius:999px;background:#333;color:#fff;cursor:pointer">Close</button>',
      '    </div>',
      '  </div>',
      '  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px">',
      '    <input id="js-seerr-discover-search" type="search" placeholder="Search Seerr for movies and TV shows..." autocomplete="off" style="flex:1;min-width:260px;padding:14px 16px;border:none;border-radius:14px;background:#1a1a1a;color:#fff;font-size:15px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)" />',
      '  </div>',
      renderDiscoverBody(),
      '</div>'
    ].join('');

    bindDiscoverPage(page);
  }

  const observer = new MutationObserver(() => {
    const href = window.location.href;

    initConfigPage();
    injectDiscoverMenuLink();
    updateDiscoverMenuState();
    ensureDiscoverPage();

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

    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('viewshow', event => {
      if (event.target && event.target.id === 'jellySeerrConfigPage') {
        bindConfigPage(event.target);
        loadConfigPage(event.target);
      }
    });

    initConfigPage();
    injectDiscoverMenuLink();
    updateDiscoverMenuState();
    ensureDiscoverPage();
    if (isDetailPage()) setTimeout(injectDetailButton, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
