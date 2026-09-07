/* ==========================================================================
   valorant-api.com access layer (shared by /map and /agent)
   ========================================================================== */

const API = 'https://valorant-api.com/v1';

/**
 * Fetch JSON with a timeout. On success the payload is cached in localStorage,
 * so a later visit with no connection still gets the full, current list; the
 * bundled snapshot is only the last resort (and is deliberately partial).
 * Returns { data, source: 'live' | 'cache' | 'bundled' }.
 */
async function fetchWithFallback(url, fallbackUrl, cacheKey, { timeout = 9000 } = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.data) || !json.data.length) {
      throw new Error('Unexpected payload');
    }
    writeCache(cacheKey, json.data);
    return { data: json.data, source: 'live' };
  } catch (err) {
    console.warn('[api] live fetch failed:', err.message);

    const cached = readCache(cacheKey);
    if (cached) return { data: cached, source: 'cache' };

    if (!fallbackUrl) throw err;
    const res = await fetch(fallbackUrl);
    if (!res.ok) throw new Error('No live API and no local snapshot.');
    const json = await res.json();
    return { data: json.data, source: 'bundled' };
  }
}

function writeCache(key, data) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch { /* quota or private mode — caching is best-effort */ }
}

function readCache(key) {
  if (!key) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && Array.isArray(raw.data) && raw.data.length) return raw.data;
  } catch { /* corrupt cache */ }
  return null;
}

/**
 * Standard 5v5 competitive maps only.
 * Riot ships the tutorial ("Basic Training"), the practice range and the
 * Skirmish/Team-Deathmatch arenas through the same endpoint; those have no
 * tacticalDescription and no displayIcon minimap.
 */
function isStandardMap(m) {
  return Boolean(
    m &&
    m.splash &&
    m.displayIcon &&
    m.tacticalDescription &&
    !/^the range$|^basic training$|^skirmish/i.test(m.displayName || '')
  );
}

export async function loadMaps() {
  const { data, source } = await fetchWithFallback(
    `${API}/maps`,
    '/data/maps.fallback.json',
    'vr.cache.maps.v1'
  );

  let maps = data.filter(isStandardMap);

  // Safety net: if Riot ever changes the shape and the strict filter guts the
  // list, loosen it rather than showing an empty app.
  if (maps.length < 4) {
    maps = data.filter((m) => m && m.splash && m.displayIcon);
  }

  maps.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    source,
    maps: maps.map((m) => ({
      id: m.uuid,
      name: m.displayName,
      sites: m.tacticalDescription || '',
      splash: m.splash,
      card: m.listViewIconTall || m.splash,
      icon: m.listViewIcon || m.displayIcon,
    })),
  };
}

/**
 * The competitive rotation, from a curated local file — Riot exposes no API for
 * it (see public/data/ranked-pool.json for the full reasoning). Fetched once on
 * load. Returns null if it is missing or unusable; callers hide the feature.
 */
export async function loadRankedPool() {
  try {
    const res = await fetch('/data/ranked-pool.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const names = Array.isArray(json.maps) ? json.maps.filter((n) => typeof n === 'string') : [];
    if (!names.length) throw new Error('no maps listed');
    return { names, label: json.label || '', patch: json.patch || '', updated: json.updated || '' };
  } catch (err) {
    console.warn('[api] ranked pool unavailable:', err.message);
    return null;
  }
}

const ROLE_ORDER = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

export async function loadAgents() {
  const { data, source } = await fetchWithFallback(
    `${API}/agents?isPlayableCharacter=true`,
    '/data/agents.fallback.json',
    'vr.cache.agents.v1'
  );

  // The endpoint has historically returned a duplicate Sova entry even with
  // the query flag set, so de-dupe by name as well as filtering.
  const seen = new Set();
  const agents = data
    .filter((a) => a && a.displayIcon && a.isPlayableCharacter !== false)
    .filter((a) => (seen.has(a.displayName) ? false : seen.add(a.displayName)));

  agents.sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.role?.displayName);
    const rb = ROLE_ORDER.indexOf(b.role?.displayName);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    source,
    roles: ROLE_ORDER,
    agents: agents.map((a) => ({
      id: a.uuid,
      name: a.displayName,
      role: a.role?.displayName || 'Agent',
      roleIcon: a.role?.displayIcon || null,
      icon: a.displayIcon,
      portrait: a.fullPortrait || a.bustPortrait || a.displayIcon,
      background: a.background || null,
      accent: pickAccent(a.backgroundGradientColors),
    })),
  };
}

/** Riot ships 8-digit RRGGBBAA strings; take the most saturated as the accent. */
function pickAccent(colors) {
  if (!Array.isArray(colors) || !colors.length) return '#ff4655';
  const hex = colors.find((c) => typeof c === 'string' && c.length >= 6) || colors[0];
  return `#${String(hex).slice(0, 6)}`;
}

/** Human-readable banner for a non-live data source (null when live). */
export function offlineNote(source) {
  if (source === 'cache') return 'Offline — using the roster cached on your last visit';
  if (source === 'bundled') return 'Offline — bundled snapshot, may be missing newer content';
  return null;
}

/** Preload images so the fast shuffle never flickers on an unloaded frame. */
export function preload(urls) {
  return Promise.all(
    urls.map(
      (src) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => resolve(src);
          img.src = src;
        })
    )
  );
}
