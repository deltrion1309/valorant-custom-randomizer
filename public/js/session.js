/* ==========================================================================
   The bridge between the two randomizers.

   The map view and the agent view are independent modules that never see each
   other. A game object, though, needs both halves: a locked map AND ten locked
   agents. This module is the one place that knows about both.

   Each view pushes its own half in whenever it changes; when both halves are
   complete, a game is logged and `vr:gamecreated` fires on the window for the
   shell to react to. State is persisted so a reload between locking the map
   and locking the last agent does not lose the map.
   ========================================================================== */

import { create } from './games.js';

const KEY = 'vr.session.v1';
const SLOTS = 5;

const state = {
  map: null,           // { id, name, icon, splash } once the roll is locked in
  teams: { a: null, b: null },   // arrays of 5 locked slots, or null while incomplete
};

restore();

/* -------------------------------------------------------------- storage -- */

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* private mode — the pairing just won't survive a reload */ }
}

function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) return;
    if (raw.map && raw.map.id) state.map = raw.map;
    ['a', 'b'].forEach((t) => {
      const side = raw.teams?.[t];
      if (Array.isArray(side) && side.length === SLOTS) state.teams[t] = side;
    });
  } catch { /* corrupt — start clean */ }
}

/* ---------------------------------------------------------------- reads -- */

export const getMap = () => state.map;
export const getTeams = () => state.teams;

/** Both halves present: a locked map and five locked slots on each team. */
export function isComplete() {
  return Boolean(
    state.map &&
    ['a', 'b'].every((t) => Array.isArray(state.teams[t]) &&
      state.teams[t].length === SLOTS &&
      state.teams[t].every((s) => s && s.agentId))
  );
}

/* --------------------------------------------------------------- writes -- */

/** The map view calls this when the landed map is locked in, or unlocked. */
export function setMap(map) {
  state.map = map
    ? { id: map.id, name: map.name, icon: map.icon || null, splash: map.splash || null }
    : null;
  persist();
  settle();
}

/**
 * The agent view calls this on every lock change. `side` is the full five-slot
 * array for that team, or null while the team still has an open slot — the
 * caller decides what "locked" means, this module only checks completeness.
 */
export function setTeam(team, side) {
  if (team !== 'a' && team !== 'b') return;
  state.teams[team] = Array.isArray(side) && side.length === SLOTS ? side : null;
  persist();
  settle();
}

/** Drop the pairing without touching either view. */
export function reset() {
  state.map = null;
  state.teams.a = null;
  state.teams.b = null;
  persist();
}

/* ------------------------------------------------------------ the latch -- */

/**
 * Log a game the moment both halves are in. `create` refuses a duplicate of the
 * newest pending entry, so toggling a lock off and straight back on re-enters
 * this without producing a second game object.
 */
let settling = false;

function settle() {
  if (settling || !isComplete()) return;

  const game = create({
    map: state.map,
    teams: { a: state.teams.a, b: state.teams.b },
  });
  if (!game) return;

  // The board has served its purpose: clear the agent halves so the app is
  // ready for the next custom game the moment this one is logged. The map is
  // deliberately kept — it is committed by the roll itself and stays until it
  // is rerolled, so the next line-up can be logged against the same map.
  //
  // The guard matters: the views unlock their slots in response to this event,
  // which calls straight back into setTeam(). Without it the latch could
  // re-enter while it is still finishing.
  settling = true;
  state.teams.a = null;
  state.teams.b = null;
  persist();

  try {
    window.dispatchEvent(new CustomEvent('vr:gamecreated', { detail: { game } }));
  } finally {
    settling = false;
  }
}
