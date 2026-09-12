/* ==========================================================================
   AGENT VIEW — two boards of five, per-slot lock-in, shuffle + reveal.

   Exported as a view module for the router: init once, then show/hide.
   ========================================================================== */

import { loadAgents, preload, offlineNote } from './api.js';
import { pickOne, drawDistinct, balancedDraw } from './random.js';
import { setTeam as setSessionTeam } from './session.js';

const STORAGE_KEY = 'vr.agentBoard.v1';
const PREFS_KEY   = 'vr.agentPrefs.v1';
const TEAMS = ['a', 'b'];
const SLOTS = 5;

const ROLL_MS  = 1500;   // length of the shuffle before the ramp finishes
const FAST_MS  = 62;     // fastest icon swap
const SLOW_MS  = 210;    // slowest swap right before the stop
const SETTLE_MS = 240;   // beat on the final line-up before the reveal fires
const FADE_RATIO = 0.85; // cross-fade length as a fraction of the frame gap
const REST_FADE = 320;   // dissolve when nothing is rolling

const $ = (sel, root) => root.querySelector(sel);

const el = {};

const state = {
  agents: [],
  byId: new Map(),
  board: { a: blankTeam(), b: blankTeam() },
  nodes: { a: [], b: [] },
  hosts: { a: null, b: null },   // the [data-slots] containers
  phase: 'idle',   // idle | rolling
  visible: false,
  raf: null,
  // OFF by default: both teams get the same shape of roles. Turned on, each
  // team is drawn independently and a 4-Duelist comp is back on the table.
  fullRandom: false,
};

function blankTeam() {
  return Array.from({ length: SLOTS }, () => ({ name: '', agentId: null, locked: false }));
}

/* ------------------------------------------------------------- storage --- */

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.board));
  } catch { /* private mode — the board just won't persist */ }
}

function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw) return;
    TEAMS.forEach((t) => {
      if (!Array.isArray(raw[t])) return;
      raw[t].slice(0, SLOTS).forEach((s, i) => {
        state.board[t][i] = {
          name: typeof s?.name === 'string' ? s.name.slice(0, 24) : '',
          agentId: state.byId.has(s?.agentId) ? s.agentId : null,
          locked: Boolean(s?.locked) && state.byId.has(s?.agentId),
        };
      });
    });
  } catch { /* corrupt state — start clean */ }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ fullRandom: state.fullRandom }));
  } catch { /* private mode — the setting just won't persist */ }
}

function restorePrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    state.fullRandom = Boolean(raw?.fullRandom);
  } catch { /* corrupt — keep the default */ }
}

/**
 * Push this team's locked line-up to session.js, which pairs it with the locked
 * map and logs a game once both halves are complete. A team with any open slot
 * publishes null — half a board is not a composition.
 */
function publishTeam(team) {
  const side = state.board[team];
  const complete = side.every((s) => s.locked && s.agentId && state.byId.has(s.agentId));

  setSessionTeam(team, complete ? side.map((s, i) => {
    const agent = state.byId.get(s.agentId);
    return {
      slot: i,
      player: s.name || '',
      agentId: agent.id,
      agentName: agent.name,
      agentIcon: agent.icon,
      role: agent.role,
    };
  }) : null);
}

const publishAll = () => TEAMS.forEach(publishTeam);

/* --------------------------------------------------------------- helpers - */

/** Agents already spoken for on this team — locked slots only. */
function lockedIds(team) {
  return new Set(state.board[team].filter((s) => s.locked && s.agentId).map((s) => s.agentId));
}

function openSlots(team) {
  return state.board[team].map((s, i) => (s.locked ? -1 : i)).filter((i) => i >= 0);
}

/* ------------------------------------------------------------------ ui --- */

function buildBoard() {
  TEAMS.forEach((team) => {
    const host = state.hosts[team];
    host.innerHTML = '';
    state.nodes[team] = [];

    for (let i = 0; i < SLOTS; i += 1) {
      const row = document.createElement('div');
      const side = team === 'a' ? 'Defenders' : 'Attackers';
      row.className = 'slot';
      row.innerHTML = `
        <div class="slot__avatar">
          <span class="slot__layers">
            <span class="slot__layer is-on"><i class="slot__bg"></i><i class="slot__icon"></i></span>
            <span class="slot__layer"><i class="slot__bg"></i><i class="slot__icon"></i></span>
          </span>
          <span class="slot__empty">?</span>
          <span class="slot__role" hidden></span>
          <span class="slot__flash"></span>
        </div>
        <div class="slot__body">
          <input class="slot__name" type="text" maxlength="24" placeholder="Player ${i + 1}"
                 aria-label="${side} player ${i + 1} name">
          <div class="slot__agent">
            <span class="slot__agentname">
              <span class="slot__nameline is-on">Unassigned</span>
              <span class="slot__nameline"></span>
            </span>
          </div>
        </div>
        <div class="slot__ctrl">
          <button class="pick" type="button" aria-haspopup="dialog" aria-expanded="false"
                  aria-label="${side} slot ${i + 1} agent">
            <span class="pick__thumb"></span>
            <span class="pick__label">Random</span>
            <span class="pick__caret" aria-hidden="true"></span>
          </button>
          <button class="lock" type="button">Lock</button>
        </div>
      `;

      const layers = [...row.querySelectorAll('.slot__layer')];
      const nameLines = [...row.querySelectorAll('.slot__nameline')];

      const node = {
        row,
        layers,
        bgs: layers.map((l) => $('.slot__bg', l)),
        icons: layers.map((l) => $('.slot__icon', l)),
        nameLines,
        front: 0,
        role: $('.slot__role', row),
        input: $('.slot__name', row),
        pick: $('.pick', row),
        pickThumb: $('.pick__thumb', row),
        pickLabel: $('.pick__label', row),
        lock: $('.lock', row),
      };

      node.input.addEventListener('input', () => {
        state.board[team][i].name = node.input.value;
        save();
        // Player names ride along into the game log, so a rename on a fully
        // locked board should reach it too.
        publishTeam(team);
      });

      node.pick.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.phase === 'rolling') return;
        openPicker(team, i, node);
      });

      node.lock.addEventListener('click', () => {
        if (state.phase === 'rolling') return;
        const slot = state.board[team][i];
        if (!slot.agentId) return;
        slot.locked = !slot.locked;
        save();
        renderTeam(team);
        syncControls();
        publishTeam(team);
      });

      host.appendChild(row);
      state.nodes[team].push(node);
    }
  });
}

/* --------------------------------------------------------------- picker -- */
/* One popover shared by all ten slots. It is a sibling of <main>, not a child
   of the slot, because the slot's clip-path would clip it away. */

const picker = {
  open: false,
  team: null,
  index: null,
  trigger: null,
  tiles: [],
};

function buildPicker() {
  el.panelBody.innerHTML = '';
  picker.tiles = [];

  const randomTile = document.createElement('button');
  randomTile.type = 'button';
  randomTile.className = 'atile atile--random';
  randomTile.dataset.id = '';
  randomTile.dataset.search = 'random';
  randomTile.innerHTML = `
    <span class="atile__img atile__img--random">?</span>
    <span class="atile__name">Random</span>`;
  randomTile.addEventListener('click', () => choose(null));
  el.panelBody.appendChild(randomTile);
  picker.tiles.push(randomTile);

  const byRole = new Map();
  state.agents.forEach((a) => {
    if (!byRole.has(a.role)) byRole.set(a.role, []);
    byRole.get(a.role).push(a);
  });

  byRole.forEach((list, role) => {
    const head = document.createElement('div');
    head.className = 'atile-head';
    head.dataset.role = role;
    head.innerHTML = `
      ${list[0].roleIcon ? `<img class="atile-head__icon" src="${list[0].roleIcon}" alt="">` : ''}
      <span>${role}</span><i></i>`;
    el.panelBody.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'atile-grid';
    grid.dataset.role = role;

    list.forEach((a) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'atile';
      tile.dataset.id = a.id;
      tile.dataset.search = a.name.toLowerCase();
      tile.title = `${a.name} — ${a.role}`;
      tile.innerHTML = `
        <span class="atile__img" style="background-image:url('${a.icon}')"></span>
        <span class="atile__name">${a.name}</span>`;
      tile.addEventListener('click', () => choose(a.id));
      grid.appendChild(tile);
      picker.tiles.push(tile);
    });

    el.panelBody.appendChild(grid);
  });
}

function openPicker(team, i, node) {
  picker.open = true;
  picker.team = team;
  picker.index = i;
  picker.trigger = node.pick;
  node.pick.setAttribute('aria-expanded', 'true');

  const slot = state.board[team][i];
  const selected = slot.locked && slot.agentId ? slot.agentId : '';
  picker.tiles.forEach((t) => t.classList.toggle('is-selected', t.dataset.id === selected));

  el.panel.dataset.team = team;
  el.panel.hidden = false;
  el.search.value = '';
  filterPicker('');
  placePicker();
  el.search.focus({ preventScroll: true });
}

function closePicker() {
  if (!picker.open) return;
  picker.open = false;
  el.panel.hidden = true;
  if (picker.trigger) picker.trigger.setAttribute('aria-expanded', 'false');
  picker.trigger = null;
}

function placePicker() {
  if (!picker.trigger) return;
  const r = picker.trigger.getBoundingClientRect();
  const p = el.panel.getBoundingClientRect();
  const gap = 8;

  let left = r.right - p.width;
  left = Math.max(10, Math.min(left, window.innerWidth - p.width - 10));

  let top = r.bottom + gap;
  if (top + p.height > window.innerHeight - 10) {
    top = Math.max(10, r.top - p.height - gap);
  }

  el.panel.style.left = `${Math.round(left)}px`;
  el.panel.style.top = `${Math.round(top)}px`;
}

function filterPicker(query) {
  const q = query.trim().toLowerCase();
  let shown = 0;

  picker.tiles.forEach((t) => {
    const hit = !q || t.dataset.search.includes(q);
    t.hidden = !hit;
    if (hit) shown += 1;
  });

  // Hide a role heading + grid pair when the filter emptied it.
  el.panelBody.querySelectorAll('.atile-grid').forEach((grid) => {
    const any = [...grid.children].some((t) => !t.hidden);
    grid.hidden = !any;
    const head = el.panelBody.querySelector(`.atile-head[data-role="${grid.dataset.role}"]`);
    if (head) head.hidden = !any;
  });

  el.empty.hidden = shown > 0;
}

function choose(agentId) {
  const { team, index } = picker;
  if (team == null) return;
  const slot = state.board[team][index];

  if (agentId) {
    slot.agentId = agentId;
    slot.locked = true;            // picking a specific agent locks it in
  } else {
    slot.locked = false;           // back to Random — keep the last roll on screen
  }

  closePicker();
  save();
  renderTeam(team);
  syncControls();
  publishTeam(team);
}

/** Paint one slot from a specific agent (used for both the roll and the result). */
function paintSlot(team, i, agent) {
  const n = state.nodes[team][i];
  const to = n.front ^ 1;   // the layer that is currently faded out

  n.icons[to].style.backgroundImage = agent ? `url("${agent.icon}")` : 'none';
  n.bgs[to].style.backgroundImage =
    agent && agent.background ? `url("${agent.background}")` : 'none';
  n.nameLines[to].textContent = agent ? agent.name : 'Unassigned';

  n.layers[to].classList.add('is-on');
  n.layers[n.front].classList.remove('is-on');
  n.nameLines[to].classList.add('is-on');
  n.nameLines[n.front].classList.remove('is-on');
  n.front = to;

  n.row.classList.toggle('has-agent', Boolean(agent));

  // Pinned to the avatar corner, so it can't shuffle sideways as names change
  // length frame to frame.
  n.role.hidden = !(agent && agent.roleIcon);
  n.role.style.backgroundImage = agent && agent.roleIcon ? `url("${agent.roleIcon}")` : 'none';
  n.role.title = agent ? agent.role : '';
}

/** Length of the next dissolve for every slot, in ms. */
function setFade(ms) {
  el.app.style.setProperty('--fade', `${Math.round(ms)}ms`);
}

function renderTeam(team) {
  state.board[team].forEach((slot, i) => {
    const n = state.nodes[team][i];
    paintSlot(team, i, slot.agentId ? state.byId.get(slot.agentId) : null);

    if (n.input.value !== slot.name) n.input.value = slot.name;

    const chosen = slot.locked && slot.agentId ? state.byId.get(slot.agentId) : null;
    n.pickLabel.textContent = chosen ? chosen.name : 'Random';
    n.pickThumb.style.backgroundImage = chosen ? `url("${chosen.icon}")` : 'none';
    n.pickThumb.classList.toggle('is-random', !chosen);

    n.row.classList.toggle('is-locked', slot.locked);
    n.lock.classList.toggle('is-on', slot.locked);
    n.lock.textContent = slot.locked ? 'Locked' : 'Lock';
    n.lock.disabled = !slot.agentId;
  });

  const locks = state.board[team].filter((s) => s.locked).length;
  $('[data-locks]', el.teams[team]).textContent = String(locks);
}

function renderAll() {
  TEAMS.forEach(renderTeam);
}

/**
 * Lock or unlock every slot at once. Only slots that actually have an agent can
 * be locked, so "Lock All" on a board that has never been rolled is a no-op
 * rather than a board full of empty locks.
 */
function setAllLocked(locked) {
  if (state.phase === 'rolling') return;
  TEAMS.forEach((team) => {
    state.board[team].forEach((slot) => {
      slot.locked = locked && Boolean(slot.agentId);
    });
  });
  save();
  renderAll();
  syncControls();
  publishAll();
}

function syncControls() {
  const open = TEAMS.reduce((n, t) => n + openSlots(t).length, 0);
  const rolling = state.phase === 'rolling';

  el.roll.disabled = rolling || open === 0;
  // There is no explanatory line under the button any more, so the reason a
  // disabled button is disabled lives in its tooltip.
  el.roll.title = open === 0 ? 'Every slot is locked — unlock one to roll again' : '';

  el.fullRandom.classList.toggle('is-on', state.fullRandom);
  el.fullRandom.setAttribute('aria-pressed', String(state.fullRandom));
  el.fullRandom.disabled = rolling;

  const withAgents = TEAMS.reduce(
    (n, t) => n + state.board[t].filter((s) => s.agentId).length, 0);
  const locked = TEAMS.reduce(
    (n, t) => n + state.board[t].filter((s) => s.locked).length, 0);
  el.lockAll.disabled = rolling || withAgents === 0 || locked === withAgents;
  el.unlockAll.disabled = rolling || locked === 0;
  el.fullRandom.title = state.fullRandom
    ? 'Full random: each team is drawn independently — one side can end up with four Duelists. Click for balanced comps.'
    : 'Balanced: both teams get the same mix of roles. Click for a completely free draw.';

  TEAMS.forEach((t) =>
    state.nodes[t].forEach((n, i) => {
      n.pick.disabled = rolling;
      n.lock.disabled = rolling || !state.board[t][i].agentId;
    })
  );
}

/* --------------------------------------------------------------- rolling - */

function buildSchedule() {
  const times = [0];
  let t = 0;
  while (t < ROLL_MS) {
    t += FAST_MS + (SLOW_MS - FAST_MS) * Math.pow(t / ROLL_MS, 2.4);
    times.push(t);
  }
  return times;
}

/**
 * The line-up for this roll: team → [{ slotIndex, agent }].
 *
 * Balanced by default — both teams receive the same multiset of roles, with
 * already-locked agents counted into that shape. If the locks make symmetry
 * impossible, or the roster is too thin to support a shape both sides can fill,
 * this falls back to the independent draw rather than refusing to roll; the
 * console says which happened.
 *
 * Note that an agent may legitimately appear on BOTH teams — Valorant enforces
 * uniqueness within a team, not across the lobby — so each team is only ever
 * filtered against its own locks.
 */
function buildPlan() {
  const open = Object.fromEntries(TEAMS.map((t) => [t, openSlots(t)]));
  if (!TEAMS.some((t) => open[t].length)) return null;

  if (!state.fullRandom) {
    const teams = Object.fromEntries(TEAMS.map((t) => [t, {
      locked: state.board[t]
        .filter((s) => s.locked && s.agentId)
        .map((s) => state.byId.get(s.agentId))
        .filter(Boolean),
    }]));

    const balanced = balancedDraw({ pool: state.agents, teams, size: SLOTS });
    if (balanced) {
      return Object.fromEntries(TEAMS.map((t) =>
        [t, open[t].map((i, k) => ({ i, agent: balanced.picks[t][k] }))]));
    }
    console.warn('[agent] balanced composition not possible here — rolling freely');
  }

  const plan = {};
  for (const team of TEAMS) {
    if (!open[team].length) { plan[team] = []; continue; }
    const taken = lockedIds(team);
    const draw = drawDistinct(state.agents.filter((a) => !taken.has(a.id)), open[team].length);
    if (!draw) {
      // Cannot happen with a full roster (25+ agents, 5 per board) but a
      // shrunken roster should fail loudly in the console, not silently.
      console.warn('[agent] not enough agents left to fill a board');
      return null;
    }
    plan[team] = open[team].map((i, k) => ({ i, agent: draw[k] }));
  }
  return plan;
}

function roll() {
  if (state.phase === 'rolling') return;

  // Work out the final line-up up front — the shuffle is then pure theatre over
  // a result that is already decided, which is what lets every slot stop on the
  // same frame.
  const plan = buildPlan();
  if (!plan) return;

  closePicker();
  state.phase = 'rolling';
  document.body.classList.add('is-spinning');
  syncControls();

  const rolling = [];
  for (const team of TEAMS) {
    const taken = lockedIds(team);
    const visual = state.agents.filter((a) => !taken.has(a.id));
    plan[team].forEach(({ i, agent }) => {
      state.nodes[team][i].row.classList.remove('is-revealed');
      state.nodes[team][i].row.classList.add('is-rolling', 'has-agent');
      rolling.push({ team, i, agent, visual });
    });
  }

  const times = buildSchedule();
  const endAt = times[times.length - 1];
  const start = performance.now();
  let step = 0;

  // One rAF loop drives every slot, so they tick — and stop — together.
  const tick = (now) => {
    const t = now - start;

    while (step < times.length && t >= times[step]) {
      const isLast = step === times.length - 1;
      const gap = isLast ? SETTLE_MS : times[step + 1] - times[step];
      setFade(gap * FADE_RATIO);
      rolling.forEach((r) => paintSlot(r.team, r.i, isLast ? r.agent : pickOne(r.visual)));
      step += 1;
    }

    if (t >= endAt + SETTLE_MS) { finish(plan, rolling); return; }
    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
}

function finish(plan, rolling) {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = null;

  TEAMS.forEach((team) => plan[team].forEach(({ i, agent }) => {
    state.board[team][i].agentId = agent.id;
  }));

  rolling.forEach(({ team, i }) => {
    const row = state.nodes[team][i].row;
    row.classList.remove('is-rolling');
    row.classList.add('is-revealed');
  });

  state.phase = 'idle';
  document.body.classList.remove('is-spinning');
  setFade(REST_FADE);
  save();
  renderAll();
  el.rollText.textContent = 'Reroll';
  syncControls();
  publishAll();

  setTimeout(() => rolling.forEach(({ team, i }) =>
    state.nodes[team][i].row.classList.remove('is-revealed')), 700);
}

/* ----------------------------------------------------------------- boot -- */

async function load() {
  el.error.hidden = true;
  el.loading.hidden = false;
  el.app.hidden = true;

  try {
    const { agents, source } = await loadAgents();
    if (agents.length < SLOTS) throw new Error('The API returned too few agents to fill a team.');

    state.agents = agents;
    state.byId = new Map(agents.map((a) => [a.id, a]));
    state.hosts = {
      a: $('[data-slots]', el.teams.a),
      b: $('[data-slots]', el.teams.b),
    };

    const note = offlineNote(source);
    el.offline.textContent = note || '';
    el.offline.hidden = !note;
    el.count.textContent = String(agents.length);

    buildBoard();
    buildPicker();
    restore();
    await preload([
      ...agents.map((a) => a.icon),
      ...new Set(agents.map((a) => a.roleIcon).filter(Boolean)),
    ]);

    el.loading.hidden = true;
    el.app.hidden = false;

    setFade(0);
    renderAll();
    setFade(REST_FADE);
    syncControls();
    publishAll();
    if (TEAMS.some((t) => state.board[t].some((s) => s.agentId))) {
      el.rollText.textContent = 'Reroll';
    }
  } catch (err) {
    console.error(err);
    el.loading.hidden = true;
    el.errorMsg.textContent = err.message || 'Unknown error.';
    el.error.hidden = false;
  }
}

/* ----------------------------------------------------- the view module --- */

export default {
  async init(root) {
    Object.assign(el, {
      loading:  $('#agentLoading', root),
      error:    $('#agentError', root),
      errorMsg: $('#agentErrorMsg', root),
      retry:    $('#agentRetry', root),
      app:      $('#agentApp', root),
      offline:  $('#agentOffline', root),
      count:    $('#countAgents', root),
      roll:     $('#rollBtn', root),
      rollText: $('#rollBtnText', root),
      fullRandom: $('#fullRandom', root),
      lockAll:    $('#lockAll', root),
      unlockAll:  $('#unlockAll', root),
      teams:    { a: $('#teamA', root), b: $('#teamB', root) },
      // The picker popover is a sibling of the views, not part of this one.
      panel:     document.getElementById('agentPanel'),
      panelBody: document.getElementById('agentBody'),
      search:    document.getElementById('agentSearch'),
      empty:     document.getElementById('agentEmpty'),
      close:     document.getElementById('agentClose'),
    });

    el.roll.addEventListener('click', roll);
    el.retry.addEventListener('click', load);

    el.fullRandom.addEventListener('click', () => {
      state.fullRandom = !state.fullRandom;
      savePrefs();
      syncControls();
    });

    el.lockAll.addEventListener('click', () => setAllLocked(true));
    el.unlockAll.addEventListener('click', () => setAllLocked(false));

    // The game is logged; the board has done its job. Release every slot so the
    // next custom game can be rolled without clearing anything by hand. This
    // does not publish — session.js has already cleared its own copy, and
    // republishing null boards from here would just be noise.
    window.addEventListener('vr:gamecreated', () => {
      if (!TEAMS.some((t) => state.board[t].some((slot) => slot.locked))) return;
      TEAMS.forEach((t) => state.board[t].forEach((slot) => { slot.locked = false; }));
      save();
      renderAll();
      syncControls();
    });

    restorePrefs();

    el.close.addEventListener('click', closePicker);
    el.search.addEventListener('input', () => filterPicker(el.search.value));
    el.panel.addEventListener('click', (e) => e.stopPropagation());

    el.search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = picker.tiles.find((t) => !t.hidden && t.dataset.id);
      if (first) first.click();
    });

    document.addEventListener('pointerdown', (e) => {
      if (picker.open && !el.panel.contains(e.target) && e.target !== picker.trigger) closePicker();
    });
    window.addEventListener('resize', () => (picker.open ? placePicker() : null));
    window.addEventListener('scroll', () => (picker.open ? placePicker() : null), true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && picker.open) { closePicker(); return; }
      if (!state.visible) return;
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); roll(); }
    });

    await load();
  },

  show() { state.visible = true; },

  hide() {
    state.visible = false;
    closePicker();          // never leave a popover floating over the other view
  },
};
