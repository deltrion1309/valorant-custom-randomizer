/* ==========================================================================
   The game log.

   Every custom game the app has set up, newest first, in localStorage. No
   server and no account, so this is per-browser: it does not follow you to
   another device, and clearing site data clears it.

   Kept DOM-free and side-effect-free apart from storage, so the state machine
   and the match-verification rules can be unit tested the way random.js is.
   ========================================================================== */

const KEY = 'vr.games.v1';
const MAX = 60;               // plenty of history, nowhere near the storage cap

export const PENDING = 'PENDING';
export const MATCHED = 'MATCHED';

/* ---------------------------------------------------------------- store -- */

export function list() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!Array.isArray(raw)) return [];
    return raw.filter((g) => g && g.id && g.map && g.teams);
  } catch {
    return [];                // corrupt — start clean rather than throw on boot
  }
}

function write(games) {
  try {
    localStorage.setItem(KEY, JSON.stringify(games.slice(0, MAX)));
    return true;
  } catch {
    return false;             // private mode or quota — the log just won't persist
  }
}

/* ------------------------------------------------------------- identity -- */

/**
 * What makes two games "the same game": the map plus the exact composition.
 * Used to stop a second game object appearing when nothing about the line-up
 * actually changed — unlocking and re-locking a slot should not log a new game.
 */
export function signature(game) {
  if (!game || !game.map) return '';
  const side = (t) => (game.teams?.[t] || [])
    .map((s) => s?.agentId || '-')
    .slice()
    .sort()
    .join(',');
  return `${game.map.id}|${side('a')}|${side('b')}`;
}

/** Every agent id in the game, both teams, sorted — the composition to match. */
export function composition(game) {
  return [...(game.teams?.a || []), ...(game.teams?.b || [])]
    .map((s) => s?.agentId)
    .filter(Boolean)
    .sort();
}

/** The same composition by agent name, lowercased — the fallback identity. */
export function compositionNames(game) {
  return [...(game.teams?.a || []), ...(game.teams?.b || [])]
    .map((s) => String(s?.agentName || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

/* --------------------------------------------------------------- writes -- */

/**
 * How close together two identical line-ups have to be to count as the same
 * game rather than a deliberate replay. Locks now clear the moment a game is
 * logged, so re-locking the same ten agents a minute later is a real second
 * game; what this still catches is a lock event firing twice in a row.
 */
export const DUPLICATE_MS = 15_000;

/**
 * Log a new game. Returns the created game, or null when it is an immediate
 * repeat of the newest entry.
 */
export function create(game) {
  const games = list();
  const newest = games[0];
  if (
    newest &&
    signature(newest) === signature(game) &&
    Date.now() - newest.createdAt < DUPLICATE_MS
  ) {
    return null;
  }

  const entry = {
    id: newId(),
    createdAt: Date.now(),
    status: PENDING,
    attempts: 0,
    match: null,
    ...game,
  };
  write([entry, ...games]);
  return entry;
}

export function update(id, patch) {
  const games = list();
  const i = games.findIndex((g) => g.id === id);
  if (i < 0) return null;
  games[i] = { ...games[i], ...patch };
  write(games);
  return games[i];
}

export function remove(id) {
  write(list().filter((g) => g.id !== id));
}

export function clear() {
  write([]);
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* -------------------------------------------------------- verification --- */

/** How far either side of the game's creation time a real match may start. */
export const MATCH_WINDOW = { before: 30 * 60 * 1000, after: 6 * 60 * 60 * 1000 };

/**
 * Does a fetched match correspond to this game?
 *
 * Three independent checks, all of which must hold. The composition is the
 * strong one — ten specific agents on one specific map is not something two
 * different lobbies collide on — while the time window exists to stop an
 * identical rematch from an earlier session being claimed by a newer entry.
 *
 * Pure, and exported on its own, so the rules can be tested without a network.
 */
export function matchesGame(game, match) {
  if (!game || !match) return false;

  const sameMap =
    String(match.map || '').trim().toLowerCase() ===
    String(game.map?.name || '').trim().toLowerCase();
  if (!sameMap) return false;

  // Compare by uuid when both sides have them, and fall back to agent names
  // otherwise. The board learns agent identity from valorant-api and the match
  // from a different service; today they agree on Riot's uuids, but a match
  // that is right should not be rejected the day one of them stops.
  const ids = composition(game);
  const gotIds = (match.agentIds || []).map((x) => String(x).toLowerCase()).sort();
  const names = compositionNames(game);
  const gotNames = (match.agentNames || []).map((x) => String(x).toLowerCase()).sort();

  const same = (a, b) => a.length === b.length && a.length > 0 && a.every((v, i) => v === b[i]);

  const byId = ids.length && gotIds.length ? same(ids, gotIds) : null;
  const byName = names.length && gotNames.length ? same(names, gotNames) : null;

  // Either identity agreeing is enough; neither agreeing — including having
  // nothing comparable at all — is a rejection.
  if (byId !== true && byName !== true) return false;

  const started = Number(match.startedAt);
  if (!Number.isFinite(started)) return false;
  return (
    started >= game.createdAt - MATCH_WINDOW.before &&
    started <= game.createdAt + MATCH_WINDOW.after
  );
}
