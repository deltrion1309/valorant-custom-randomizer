/* ==========================================================================
   MAP VIEW — two stages.

     ban   pick/ban board, then Skip or Confirm
     roll  the hero, the Randomize button, and a way back to the bans

   Exported as a view module for the router: init once, then show/hide/route.
   ========================================================================== */

import { loadMaps, loadRankedPool, preload, offlineNote } from './api.js';
import { pickOne, pickOther } from './random.js';

const STORAGE_KEY = 'vr.bannedMaps.v1';
const IDLE_MS  = 9000;   // how long standby holds on each map before dissolving
const SPIN_MS  = 2000;   // length of the fast phase before the ramp finishes
const FAST_MS  = 58;     // fastest frame interval
const SLOW_MS  = 520;    // slowest frame interval right before the stop
const SETTLE_MS = 280;   // beat of dead air on the winner before the reveal fires
const FADE_RATIO = 0.85; // cross-fade length as a fraction of the frame gap
const IDLE_FADE = 850;   // gentle dissolve while idling
const LAND_FADE = 420;   // dissolve onto the winner

const $ = (sel, root) => root.querySelector(sel);

const el = {};
let navigate = () => {};

const state = {
  maps: [],
  banned: new Set(),
  ranked: null,    // { ids:Set, label } once the rotation file resolves
  current: null,
  stage: 'ban',    // ban | roll
  phase: 'idle',   // idle | spinning | landed
  visible: false,
  idleTimer: null,
  raf: null,
  frontLayer: 'a',
};

/* ------------------------------------------------------------- storage --- */

function loadBans() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(raw)) return new Set(raw);
  } catch { /* ignore corrupt state */ }
  return new Set();
}

function saveBans() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.banned]));
  } catch { /* private mode — bans just won't persist */ }
}

/* --------------------------------------------------------------- helpers - */

const activeMaps = () => state.maps.filter((m) => !state.banned.has(m.id));
const canRoll = () => activeMaps().length >= 2;

/**
 * True when the bans are exactly "everything outside the competitive rotation" —
 * i.e. the board is showing the ranked pool and nothing else. Any extra ban or
 * any pool map left banned drops it back to false.
 */
function isRankedSelection() {
  if (!state.ranked) return false;
  return state.maps.every((m) => state.banned.has(m.id) !== state.ranked.ids.has(m.id));
}

const isRanked = (map) => Boolean(map && state.ranked && state.ranked.ids.has(map.id));

/** Ban every map that isn't in the competitive rotation. */
function banToRankedPool() {
  if (!state.ranked) return;
  state.banned = new Set(
    state.maps.filter((m) => !state.ranked.ids.has(m.id)).map((m) => m.id)
  );
  saveBans();
  afterPoolChange();
}

/* ----------------------------------------------------------------- view -- */

/** Swap the hero image. `light` skips the bookkeeping that isn't visible
 *  mid-shuffle, so a frame costs nothing but the two class flips. */
function showMap(map, { light = false } = {}) {
  if (!map) return;
  state.current = map;

  const toB = state.frontLayer === 'a';
  const imgIn  = toB ? el.layerB : el.layerA;
  const imgOut = toB ? el.layerA : el.layerB;
  const txtIn  = toB ? el.nameB  : el.nameA;
  const txtOut = toB ? el.nameA  : el.nameB;

  imgIn.style.backgroundImage = `url("${map.splash}")`;
  imgIn.classList.add('is-on');
  imgOut.classList.remove('is-on');

  // The name rides the same cross-fade as the artwork.
  txtIn.textContent = map.name;
  txtIn.classList.add('is-on');
  txtOut.classList.remove('is-on');

  state.frontLayer = toB ? 'b' : 'a';
  setStageRanked(map);
  if (!light) markCurrentCard();
}

/** The hero's ranked flag — kept in step with the art on every frame, shuffle
 *  included, so it never disagrees with the map on screen. */
function setStageRanked(map) {
  el.stageRanked.hidden = !isRanked(map);
}

/** Length of the next dissolve, in ms. */
function setFade(ms) {
  el.stage.style.setProperty('--fade', `${Math.round(ms)}ms`);
}

/** The single status chip. Kept out of showMap so it never resizes mid-spin. */
function setStatus(text, red = false) {
  el.status.textContent = text;
  el.status.classList.toggle('is-live', red);
}

function markCurrentCard() {
  el.grid.querySelectorAll('.card').forEach((c) => {
    c.classList.toggle('is-current', state.current && c.dataset.id === state.current.id);
  });
}

/* ------------------------------------------------------------ idle cycle - */

function startIdle() {
  stopIdle();
  // Only worth running while the roll stage is actually on screen.
  if (!state.visible || state.stage !== 'roll' || activeMaps().length < 2) return;
  state.idleTimer = setInterval(() => {
    if (state.phase !== 'idle') return;
    setFade(IDLE_FADE);
    const next = pickOther(activeMaps(), state.current);
    if (next) showMap(next);
  }, IDLE_MS);
}

function stopIdle() {
  if (state.idleTimer) clearInterval(state.idleTimer);
  state.idleTimer = null;
}

/* ----------------------------------------------------------- spin cycle -- */

/**
 * Frame schedule: one continuous cubic ramp from FAST_MS to SLOW_MS, so the
 * carousel glides to a halt instead of dropping off a cliff. Returns the
 * absolute timestamps (ms from spin start) at which the image should swap.
 */
function buildSchedule() {
  const times = [0];
  let t = 0;
  while (t < SPIN_MS) {
    t += FAST_MS + (SLOW_MS - FAST_MS) * Math.pow(t / SPIN_MS, 2.6);
    times.push(t);
  }
  return times;
}

function spin() {
  const pool = activeMaps();
  if (state.stage !== 'roll' || state.phase === 'spinning' || pool.length < 2) return;

  state.phase = 'spinning';
  stopIdle();
  document.body.classList.add('is-spinning');
  el.stage.classList.remove('is-landed');
  el.stage.classList.add('is-shuffling');
  el.spin.disabled = true;
  el.editBans.disabled = true;
  setStatus('Shuffling', true);

  const winner = pickOther(pool, state.current);
  const times = buildSchedule();
  const endAt = times[times.length - 1];
  const start = performance.now();

  let i = 0;
  let last = state.current;

  // Driven by rAF so every swap lands on a real display frame — setTimeout
  // drifts against the compositor, which is what made the tail feel steppy.
  const tick = (now) => {
    const t = now - start;

    while (i < times.length && t >= times[i]) {
      const isLast = i === times.length - 1;
      const gap = isLast ? SETTLE_MS : times[i + 1] - times[i];

      // Dissolve for most of the gap: quick early on, luxurious at the end.
      setFade(gap * FADE_RATIO);

      const next = isLast ? winner : pickOther(pool, last);
      last = next;
      showMap(next, { light: true });
      i += 1;
    }

    el.bar.style.width = `${Math.min(100, (t / endAt) * 100)}%`;

    if (t >= endAt + SETTLE_MS) {
      land(winner);
      return;
    }
    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
}

function land(winner) {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = null;

  state.phase = 'landed';
  el.stage.classList.remove('is-shuffling');
  el.stage.classList.add('is-landed');
  setFade(LAND_FADE);
  document.body.classList.remove('is-spinning');
  el.bar.style.width = '0%';

  // The winner is already on screen — don't swap layers again, that was the
  // extra flicker at the end of the spin.
  state.current = winner;
  markCurrentCard();
  setStageRanked(winner);
  setStatus('Locked In', true);

  el.spin.disabled = false;
  el.editBans.disabled = false;
  el.spinText.textContent = 'Reroll';

  setTimeout(() => el.stage.classList.remove('is-landed'), 950);
}

/* ------------------------------------------------------------ ban board -- */

function buildGrid() {
  el.grid.innerHTML = '';
  state.maps.forEach((m) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = m.id;
    card.setAttribute('aria-pressed', 'false');
    card.innerHTML = `
      <span class="card__img" style="background-image:url('${m.card}')"></span>
      <span class="card__shade"></span>
      <span class="card__edge"></span>
      <span class="card__x" aria-hidden="true">
        <svg viewBox="0 0 100 100"><path d="M12 12 L88 88 M88 12 L12 88" fill="none" stroke-linecap="square"/></svg>
      </span>
      <span class="card__banner">Banned</span>
      ${isRanked(m) ? '<span class="card__ranked"><i aria-hidden="true"></i>Ranked</span>' : ''}
      <span class="card__name">${m.name}</span>
    `;
    card.addEventListener('click', () => toggleBan(m.id));
    el.grid.appendChild(card);
  });
  syncBoard();
}

function toggleBan(id) {
  if (state.banned.has(id)) state.banned.delete(id);
  else state.banned.add(id);
  saveBans();
  afterPoolChange();
}

function setAllBanned(banned) {
  state.banned = banned ? new Set(state.maps.map((m) => m.id)) : new Set();
  saveBans();
  afterPoolChange();
}

function afterPoolChange() {
  syncBoard();
  const pool = activeMaps();

  // If the map held over from a previous session just got banned, slide off it.
  if (state.current && state.banned.has(state.current.id) && pool.length) {
    setFade(IDLE_FADE);
    showMap(pickOne(pool));
  }

  if (state.phase === 'landed') {
    state.phase = 'idle';
    el.spinText.textContent = 'Randomize';
    setStatus('Standby');
  }
  startIdle();
}

/** One place that reflects the ban set into every control on both stages. */
function syncBoard() {
  const pool = activeMaps();
  const bans = state.banned.size;

  el.grid.querySelectorAll('.card').forEach((c) => {
    const banned = state.banned.has(c.dataset.id);
    c.classList.toggle('is-banned', banned);
    c.setAttribute('aria-pressed', String(banned));
    c.title = banned ? 'Banned — click to re-activate' : 'Active — click to ban';
  });

  [[el.count, el.total], [el.count2, el.total2]].forEach(([n, t]) => {
    n.textContent = String(pool.length);
    n.classList.toggle('is-low', pool.length < 2);
    t.textContent = String(state.maps.length);
  });

  el.selectAll.disabled = bans === 0;
  el.banAll.disabled = pool.length === 0;

  // Once the board already IS the rotation the button has nothing left to do:
  // same box, lit up, inert. Change the selection by hand and it goes back to
  // being a button. The randomizer's twin mirrors that lit state.
  const onRanked = isRankedSelection();
  el.ranked.classList.toggle('is-on', onRanked);
  el.ranked.setAttribute('aria-disabled', String(onRanked));
  el.badgeRoll.classList.toggle('is-off', !onRanked);

  // Continue is only legal with at least two maps left to draw from.
  const ok = canRoll();
  el.continue.disabled = !ok;
  el.continueText.textContent = bans === 0 ? 'Skip Banning' : 'Confirm Bans';
  el.banHint.classList.toggle('is-warn', !ok);
  el.banHint.textContent = ok
    ? ''
    : pool.length === 0
      ? 'EVERY MAP IS BANNED — LEAVE AT LEAST TWO ACTIVE'
      : 'ONLY ONE MAP LEFT — LEAVE AT LEAST TWO ACTIVE';

  el.spin.disabled = !ok;
  markCurrentCard();
}

/* ---------------------------------------------------------------- stages - */

function setStage(next) {
  const stage = next === 'roll' && canRoll() ? 'roll' : 'ban';
  state.stage = stage;

  el.phaseBan.hidden = stage !== 'ban';
  el.phaseRoll.hidden = stage !== 'roll';
  lockVisibleCounter(stage);

  if (stage === 'roll') {
    if (!state.current) {
      setFade(0);
      showMap(pickOne(activeMaps()) || state.maps[0]);
      setFade(IDLE_FADE);
    }
    startIdle();
  } else {
    stopIdle();
  }
  return stage;
}

/**
 * Pin the counter's number to the width of the widest value it can ever show.
 *
 * A CSS `min-width: 2ch` isn't enough: `ch` is the width of "0", and Bebas Neue
 * doesn't give every digit that width, so "12" and "7" still differed by ~2.5px
 * — and since the counter is the last item in a `flex: 1`-ruled row, that
 * shortfall slid the whole head across. Measuring the real glyphs is exact and
 * survives a font or size change.
 */
async function lockCounterWidth(node, maxValue) {
  try {
    await document.fonts.ready;   // measuring before the webfont lands is a lie
  } catch { /* no font loading API — measure what we have */ }

  // A counter inside a hidden phase has no boxes and every measurement comes
  // back 0, which would pin it to nothing. Bail and let the caller retry.
  if (!node.getClientRects().length) return false;

  const digits = String(Math.max(1, maxValue)).length;
  const restore = node.textContent;
  const prevMin = node.style.minWidth;
  node.style.minWidth = '0px';

  let widest = '0';
  let best = 0;
  for (let d = 0; d <= 9; d += 1) {
    node.textContent = String(d);
    const w = node.getBoundingClientRect().width;
    if (w > best) { best = w; widest = String(d); }
  }

  if (!best) {
    node.style.minWidth = prevMin;
    node.textContent = restore;
    return false;
  }

  node.textContent = widest.repeat(digits);
  const target = Math.ceil(node.getBoundingClientRect().width);
  node.textContent = restore;
  node.style.minWidth = `${target}px`;
  return true;
}

/** Lock a stage's counter the first time that stage is actually on screen. */
const counterLocked = { ban: false, roll: false };

function lockVisibleCounter(stage) {
  if (counterLocked[stage] || !state.maps.length) return;
  counterLocked[stage] = true;
  const node = stage === 'roll' ? el.count2 : el.count;
  lockCounterWidth(node, state.maps.length).then((ok) => {
    if (!ok) counterLocked[stage] = false;   // retry next time it is shown
  });
}

/* --------------------------------------------------------- ranked pool --- */

/**
 * Match the curated rotation names against the live map list, case-insensitively.
 * Names that match nothing are reported and dropped — a stale entry should not
 * break the button. Fewer than two survivors means there is nothing to draw
 * from, so the feature switches itself off.
 */
function resolveRanked(pool, maps) {
  if (!pool) return null;

  const byName = new Map(maps.map((m) => [m.name.toLowerCase(), m]));
  const ids = new Set();
  const missing = [];

  pool.names.forEach((n) => {
    const hit = byName.get(String(n).trim().toLowerCase());
    if (hit) ids.add(hit.id);
    else missing.push(n);
  });

  if (missing.length) {
    console.warn(`[map] ranked pool lists ${missing.join(', ')} — not in the live map list`);
  }
  if (ids.size < 2 || ids.size === maps.length) return null;

  return { ids, label: pool.label || '', count: ids.size };
}

/* ----------------------------------------------------------------- boot -- */

async function load() {
  el.error.hidden = true;
  el.loading.hidden = false;
  el.app.hidden = true;

  try {
    // The rotation file is fetched once, next to the map list, and is never
    // allowed to fail the load — the feature just hides itself.
    const [{ maps, source }, ranked] = await Promise.all([loadMaps(), loadRankedPool()]);
    if (!maps.length) throw new Error('The API returned no usable maps.');

    state.maps = maps;
    // Drop stale ids (a map left rotation while bans were stored).
    const ids = new Set(maps.map((m) => m.id));
    state.banned = new Set([...loadBans()].filter((id) => ids.has(id)));

    state.ranked = resolveRanked(ranked, maps);
    // Whether the slot exists at all is settled once, at load — so it can never
    // appear or vanish mid-session and shift the row.
    el.flagBan.hidden = !state.ranked;
    el.flagRoll.hidden = !state.ranked;
    if (state.ranked) {
      const where = state.ranked.label ? ` (${state.ranked.label})` : '';
      el.ranked.title = `Ban everything outside the competitive rotation${where}`;
      el.badgeRoll.title =
        `The ${state.ranked.count} maps in the competitive rotation${where}`;
    }

    const note = offlineNote(source);
    el.offline.textContent = note || '';
    el.offline.hidden = !note;

    buildGrid();
    await preload(maps.map((m) => m.splash));

    el.loading.hidden = true;
    el.app.hidden = false;

    setStatus('Standby');
    syncBoard();
  } catch (err) {
    console.error(err);
    el.loading.hidden = true;
    el.errorMsg.textContent = err.message || 'Unknown error.';
    el.error.hidden = false;
  }
}

/* ----------------------------------------------------- the view module --- */

export default {
  async init(root, ctx) {
    navigate = ctx.navigate;

    Object.assign(el, {
      loading:  $('#mapLoading', root),
      error:    $('#mapError', root),
      errorMsg: $('#mapErrorMsg', root),
      retry:    $('#mapRetry', root),
      app:      $('#mapApp', root),
      offline:  $('#mapOffline', root),

      phaseBan:  $('#phaseBan', root),
      phaseRoll: $('#phaseRoll', root),

      grid:      $('#grid', root),
      count:     $('#countActive', root),
      total:     $('#countTotal', root),
      count2:    $('#countActive2', root),
      total2:    $('#countTotal2', root),
      selectAll: $('#selectAll', root),
      banAll:    $('#banAll', root),
      ranked:    $('#rankedPool', root),
      flagBan:   $('#flagBan', root),
      flagRoll:  $('#flagRoll', root),
      badgeRoll: $('#poolBadgeRoll', root),
      stageRanked: $('#stageRanked', root),
      continue:     $('#banContinue', root),
      continueText: $('#banContinueText', root),
      banHint:   $('#banHint', root),

      stage:    $('#stage', root),
      layerA:   $('#layerA', root),
      layerB:   $('#layerB', root),
      nameA:    $('#nameA', root),
      nameB:    $('#nameB', root),
      status:   $('#mapStatus', root),
      bar:      $('#spinBar', root),
      spin:     $('#spinBtn', root),
      spinText: $('#spinBtnText', root),
      editBans: $('#editBans', root),
    });

    el.spin.addEventListener('click', spin);
    el.retry.addEventListener('click', load);
    el.selectAll.addEventListener('click', () => setAllBanned(false));
    el.banAll.addEventListener('click', () => setAllBanned(true));
    el.ranked.addEventListener('click', banToRankedPool);
    el.continue.addEventListener('click', () => canRoll() && navigate('/map'));
    el.editBans.addEventListener('click', () => navigate('/map/ban'));

    document.addEventListener('keydown', (e) => {
      if (!state.visible || state.stage !== 'roll') return;
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); spin(); }
    });

    await load();
  },

  show() {
    state.visible = true;
    startIdle();
  },

  hide() {
    state.visible = false;
    stopIdle();
  },

  /** Called by the router for /map/ban and /map. */
  route(sub) {
    const landed = setStage(sub);
    // Deep-linked to /map with fewer than two maps active — the roll stage
    // can't do anything, so put the URL back where the user actually is.
    if (landed !== sub) navigate('/map/ban', { replace: true });
  },
};
