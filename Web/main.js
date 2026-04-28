(function () {
  'use strict';

  const GUID = '3b4f8e2a-7c91-4d05-b3e6-1a2f9c847d30';

  // All Seerr calls are proxied through Jellyfin's own API to avoid CORS.
  const API = '/plugins/JellySeerr';

  // Seerr media status codes
  const Status = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIAL: 4, AVAILABLE: 5 };

  // ── Auth ─────────────────────────────────────────────────────────────────

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

  // ── Jellyfin item lookup ─────────────────────────────────────────────────

  function getItemId() {
    const src = window.location.hash + window.location.search;
    const m = src.match(/[?&]id=([^&]+)/);
    return m ? m[1] : null;
  }

  function isDetailPage() {
    return /\/details|#.*details/i.test(window.location.href);
  }

  async function getJellyfinItem(itemId) {
    try {
      return await apiFetch('/Items/' + itemId + '?Fields=ProviderIds');
    } catch { return null; }
  }

  // ── Seerr proxy calls ────────────────────────────────────────────────────

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

  async function seerrRequest(mediaType, mediaId) {
    const body = { mediaType: mediaType, mediaId: Number(mediaId) };
    if (mediaType === 'tv') body.seasons = 'all';
    try {
      return await apiFetch(API + '/Request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch { return null; }
  }

  // ── Status helpers ───────────────────────────────────────────────────────

  function statusInfo(status) {
    switch (status) {
      case Status.AVAILABLE:
        return { label: '✓ In Library', color: '#4caf50', disabled: true };
      case Status.PENDING:
      case Status.PROCESSING:
        return { label: '🔔 Requested', color: '#ff9800', disabled: true };
      case Status.PARTIAL:
        return { label: '🔔 Partial', color: '#ff9800', disabled: true };
      default:
        return { label: '+ Request', color: '#00a4dc', disabled: false };
    }
  }

  // ── Config page ──────────────────────────────────────────────────────────

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

  // ── Detail page button ───────────────────────────────────────────────────

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

  // Jellyfin's detail page button container shifts between versions —
  // try several selectors and fall back to inserting after the play button.
  function findDetailContainer() {
    const selectors = [
      '.detailButtons',
      '.itemDetailButtons',
      '[class*="detailButton"]',
      '[class*="DetailButton"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // Fallback: find a recognised action button and use its parent
    const known = ['Play', 'Shuffle', 'Trailer', 'More'].map(t =>
      document.querySelector('button[title="' + t + '"]')
    ).find(Boolean);
    return known ? known.parentElement : null;
  }

  let lastDetailId = null;
  let retryTimer = null;

  async function injectDetailButton() {
    if (!isDetailPage()) return;

    const itemId = getItemId();
    if (!itemId) return;

    // Remove stale button if navigated to a new item
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
    btn.textContent = '…';
    btn.disabled = true;
    btn.style.cssText = btnStyle('#555');
    container.appendChild(btn);

    const data = await seerrStatus(mediaType, tmdbId);
    const info = statusInfo(data?.mediaInfo?.status);
    btn.textContent = info.label;
    btn.style.cssText = btnStyle(info.color);
    btn.disabled = info.disabled;

    if (!info.disabled) {
      btn.addEventListener('click', async () => {
        btn.textContent = 'Requesting…';
        btn.disabled = true;
        const result = await seerrRequest(mediaType, tmdbId);
        if (result) {
          const done = statusInfo(Status.PENDING);
          btn.textContent = done.label;
          btn.style.cssText = btnStyle(done.color);
        } else {
          btn.textContent = '✕ Failed — retry';
          btn.style.cssText = btnStyle('#e53935');
          btn.disabled = false;
        }
      });
    }
  }

  // ── Search modal ─────────────────────────────────────────────────────────

  function buildResultCard(item) {
    const tmdbId = item.id;
    const mediaType = item.mediaType; // 'movie' | 'tv'
    const title = item.title || item.name || 'Unknown';
    const year = (item.releaseDate || item.firstAirDate || '').slice(0, 4);
    const poster = item.posterPath
      ? 'https://image.tmdb.org/t/p/w92' + item.posterPath
      : null;
    const info = statusInfo(item.mediaInfo ? item.mediaInfo.status : Status.UNKNOWN);

    const card = document.createElement('div');
    card.style.cssText = [
      'display:flex', 'align-items:center', 'gap:12px',
      'background:#1c1c1c', 'border-radius:8px', 'padding:10px',
    ].join(';');

    const img = poster
      ? '<img src="' + poster + '" style="width:46px;height:69px;border-radius:4px;object-fit:cover;flex-shrink:0" />'
      : '<div style="width:46px;height:69px;background:#333;border-radius:4px;flex-shrink:0"></div>';

    card.innerHTML = img + [
      '<div style="flex:1;min-width:0">',
      '  <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(title) + '</div>',
      '  <div style="font-size:12px;color:#aaa;margin-top:2px">' + escHtml(year) + ' · ' + (mediaType === 'tv' ? 'TV Show' : 'Movie') + '</div>',
      '</div>',
      '<button style="' + btnStyle(info.color) + ';white-space:nowrap"' + (info.disabled ? ' disabled' : '') + '>',
      escHtml(info.label),
      '</button>',
    ].join('');

    const btn = card.querySelector('button');
    if (!info.disabled) {
      btn.addEventListener('click', async () => {
        btn.textContent = 'Requesting…';
        btn.disabled = true;
        const result = await seerrRequest(mediaType, tmdbId);
        if (result) {
          const done = statusInfo(Status.PENDING);
          btn.textContent = done.label;
          btn.style.background = done.color;
        } else {
          btn.textContent = '✕ Failed';
          btn.style.background = '#e53935';
          btn.disabled = false;
        }
      });
    }

    return card;
  }

  async function runSearch(query, resultsEl) {
    if (!query) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<div style="text-align:center;padding:24px;color:#888">Searching…</div>';

    const data = await seerrSearch(query);
    resultsEl.innerHTML = '';

    if (!data?.results?.length) {
      resultsEl.innerHTML = '<div style="text-align:center;padding:24px;color:#888">No results found</div>';
      return;
    }

    data.results.forEach(item => resultsEl.appendChild(buildResultCard(item)));
  }

  function openModal() {
    if (document.getElementById('js-seerr-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'js-seerr-modal';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,.87)',
      'display:flex', 'flex-direction:column', 'align-items:center',
      'padding:40px 16px 16px',
      'font-family:inherit', 'color:#fff',
    ].join(';');

    overlay.innerHTML = [
      '<div style="width:100%;max-width:740px;display:flex;flex-direction:column;gap:12px">',
      '  <div style="display:flex;gap:10px;align-items:center">',
      '    <input id="js-seerr-input" placeholder="Search movies &amp; TV shows…"',
      '      autocomplete="off"',
      '      style="flex:1;padding:11px 14px;border-radius:6px;border:none;background:#2a2a2a;color:#fff;font-size:15px" />',
      '    <button id="js-seerr-close"',
      '      style="padding:9px 14px;border:none;border-radius:6px;background:#444;color:#fff;cursor:pointer;font-size:16px">✕</button>',
      '  </div>',
      '  <div id="js-seerr-results" style="overflow-y:auto;max-height:calc(100vh - 150px);display:flex;flex-direction:column;gap:8px"></div>',
      '</div>',
    ].join('');

    document.body.appendChild(overlay);

    const input = overlay.querySelector('#js-seerr-input');
    const results = overlay.querySelector('#js-seerr-results');
    const closeBtn = overlay.querySelector('#js-seerr-close');

    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
    });

    let searchTimer;
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      searchTimer = setTimeout(() => runSearch(q, results), 380);
    });

    input.focus();
  }

  // ── Floating action button ────────────────────────────────────────────────

  function injectFab() {
    if (document.getElementById('js-seerr-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'js-seerr-fab';
    fab.title = 'Request via Seerr';
    fab.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px',
      'width:52px', 'height:52px', 'border-radius:50%',
      'background:#00a4dc', 'color:#fff',
      'border:none', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'box-shadow:0 4px 14px rgba(0,0,0,.55)',
      'z-index:9999', 'transition:transform .15s',
    ].join(';');
    fab.innerHTML = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22">',
      '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61',
      '0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01',
      '5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>',
      '</svg>',
    ].join('');
    fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.1)'; });
    fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });
    fab.addEventListener('click', openModal);
    document.body.appendChild(fab);
  }

  // ── SPA navigation watcher ───────────────────────────────────────────────

  let lastHref = '';

  const observer = new MutationObserver(() => {
    const href = window.location.href;

    initConfigPage();
    injectFab();

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

  // ── Utilities ────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Boot ─────────────────────────────────────────────────────────────────

  function init() {
    if (!document.body) { setTimeout(init, 100); return; }
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('viewshow', event => {
      if (event.target && event.target.id === 'jellySeerrConfigPage') {
        bindConfigPage(event.target);
        loadConfigPage(event.target);
      }
    });
    initConfigPage();
    injectFab();
    if (isDetailPage()) setTimeout(injectDetailButton, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
