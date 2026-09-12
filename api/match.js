/* ==========================================================================
   /api/match — the server side of finalizing a game.

   Why this exists at all: the browser cannot call a match API directly. The key
   would be in the page source for anyone to take, and the upstream sends no
   CORS headers. Running it here solves both — the browser only ever talks to
   this origin, so there is no preflight and no cross-origin request, and the
   key stays in an environment variable the client never sees.

   This function deliberately does NOT decide which match is yours. It fetches
   the recent matches for a Riot ID and normalizes them; the caller matches them
   against the game it logged using the rules in public/js/games.js, which are
   pure and unit-tested. One implementation of "is this the right match", in the
   place where it can be tested.

   Deploy note: set HENRIK_API_KEY in the Vercel project's environment
   variables. There is no fallback and no key in this repo — without it the
   endpoint reports itself unconfigured and the UI falls back to manual entry.
   ========================================================================== */

// Overridable so the normalizer can be exercised against a recorded payload in
// tests without reaching the real service. Unset everywhere but a test run.
const UPSTREAM = process.env.HENRIK_API_BASE || 'https://api.henrikdev.xyz/valorant/v4/matches';
const REGIONS = new Set(['eu', 'na', 'ap', 'kr', 'br', 'latam']);
const TIMEOUT_MS = 12_000;
const SIZE = 10;              // the most the upstream returns in one page

/* -------------------------------------------------------------- helpers -- */

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const lower = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Average Combat Score. The upstream reports total combat score, which is only
 * comparable between players once it is divided by the rounds played — and a
 * custom game can end at any score, so the round count has to come from the
 * match rather than being assumed to be 24.
 */
function acs(score, rounds) {
  if (!rounds || !Number.isFinite(score)) return null;
  return Math.round(score / rounds);
}

/** Upstream match → the small, stable shape the app actually renders. */
function normalize(raw) {
  const meta = raw?.metadata || {};
  const players = Array.isArray(raw?.players) ? raw.players : [];
  const teams = Array.isArray(raw?.teams) ? raw.teams : [];

  const rounds = teams.reduce(
    (n, t) => Math.max(n, (t?.rounds?.won || 0) + (t?.rounds?.lost || 0)),
    0
  );

  const startedAt = Date.parse(meta.started_at);

  return {
    matchId: meta.match_id || null,
    map: meta.map?.name || '',
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    queue: meta.queue?.name || meta.queue?.id || '',
    rounds,
    isCompleted: meta.is_completed !== false,

    // Both, because the two sides of this app learn agent identity from
    // different places: the board stores valorant-api uuids, and there is no
    // guarantee forever that the upstream uses the same ones. Names are the
    // belt to the uuid's braces.
    agentIds: players.map((p) => lower(p?.agent?.id)).filter(Boolean),
    agentNames: players.map((p) => lower(p?.agent?.name)).filter(Boolean),

    teams: teams.map((t) => ({
      id: t?.team_id || '',
      won: Boolean(t?.won),
      roundsWon: t?.rounds?.won ?? null,
      roundsLost: t?.rounds?.lost ?? null,
      agentIds: players
        .filter((p) => p?.team_id === t?.team_id)
        .map((p) => lower(p?.agent?.id))
        .filter(Boolean),
    })),

    players: players.map((p) => ({
      name: p?.name || '',
      tag: p?.tag || '',
      teamId: p?.team_id || '',
      agentId: lower(p?.agent?.id),
      agentName: p?.agent?.name || '',
      tierId: Number.isFinite(p?.tier?.id) ? p.tier.id : null,
      tierName: p?.tier?.name || '',
      acs: acs(p?.stats?.score, rounds),
      kills: p?.stats?.kills ?? null,
      deaths: p?.stats?.deaths ?? null,
      assists: p?.stats?.assists ?? null,
    })),
  };
}

/* ------------------------------------------------------------- the route - */

export async function lookup({ name, tag, region, platform = 'pc' }) {
  const key = process.env.HENRIK_API_KEY;
  if (!key) {
    return { status: 503, body: { ok: false, code: 'unconfigured',
      reason: 'Match lookup is not configured on the server.' } };
  }

  const riotName = clean(name, 32);
  const riotTag = clean(tag, 8);
  const affinity = lower(region) || 'eu';

  if (!riotName || !riotTag) {
    return { status: 400, body: { ok: false, code: 'bad_request',
      reason: 'A Riot ID name and tag are required.' } };
  }
  if (!REGIONS.has(affinity)) {
    return { status: 400, body: { ok: false, code: 'bad_request',
      reason: `Unknown region "${affinity}".` } };
  }

  const url = `${UPSTREAM}/${affinity}/${platform === 'console' ? 'console' : 'pc'}`
    + `/${encodeURIComponent(riotName)}/${encodeURIComponent(riotTag)}?size=${SIZE}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res;
  let json;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Authorization: key, Accept: 'application/json' },
    });
    json = await res.json().catch(() => null);
  } catch (err) {
    clearTimeout(timer);
    const aborted = err.name === 'AbortError';
    return { status: 504, body: { ok: false, code: aborted ? 'timeout' : 'network',
      reason: aborted ? 'The match service did not answer in time.'
                      : 'Could not reach the match service.' } };
  }
  clearTimeout(timer);

  // Pass the upstream's own verdict through in the cases a user can act on.
  if (res.status === 404) {
    return { status: 404, body: { ok: false, code: 'no_player',
      reason: `No Riot account found for ${riotName}#${riotTag} in ${affinity.toUpperCase()}.` } };
  }
  if (res.status === 429) {
    return { status: 429, body: { ok: false, code: 'rate_limited',
      reason: 'The match service is rate-limiting us. Try again in a minute.' } };
  }
  if (res.status === 401 || res.status === 403) {
    return { status: 502, body: { ok: false, code: 'auth',
      reason: 'The match service rejected our API key.' } };
  }
  if (!res.ok || !json || !Array.isArray(json.data)) {
    return { status: 502, body: { ok: false, code: 'upstream',
      reason: `The match service returned an unexpected response (HTTP ${res.status}).` } };
  }

  return { status: 200, body: { ok: true, matches: json.data.map(normalize) } };
}

/** Vercel entry point. */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, code: 'method', reason: 'POST only.' });
    return;
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const { status, body: out } = await lookup(body);

  // Never cached: the answer changes as soon as a match is processed upstream.
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(out);
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return {}; }
}
