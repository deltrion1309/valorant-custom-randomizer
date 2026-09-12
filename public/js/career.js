/* ==========================================================================
   CAREER VIEW — the log of custom games this browser has set up.

   A game lands here the moment the map is rolled and all ten agents are locked
   (see session.js). It starts PENDING: the app knows what was supposed to be
   played, not what happened.

   Finalizing has two paths, and they share everything downstream of the lookup:

     Automatic  /api/match fetches your recent matches server-side and returns
                them normalized. This module decides which one is yours, using
                matchesGame() from games.js — map + the exact ten agents + a
                plausible start time. A wrong match written into the log is
                worse than no match, so the decision is never the server's.

     Manual     A form pre-filled with the line-up we already know. Always
                available, and the only path when the lookup is unconfigured,
                rate-limited or simply cannot find the game.
   ========================================================================== */

import { list, remove, update, matchesGame, PENDING, MATCHED } from './games.js';
import { loadRankTiers } from './api.js';

const RIOT_KEY = 'vr.riotid.v1';
const COOLDOWN_MS = 60_000;
const REGIONS = ['eu', 'na', 'ap', 'kr', 'br', 'latam'];

let root = null;
let mounted = false;
let tiers = null;          // rank id → { name, icon }, loaded lazily
let busy = null;           // id of the game currently being looked up

const el = {};
let ticker = null;

const $ = (sel, node) => node.querySelector(sel);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cooldownUntil = (game) => Number(game?.cooldownUntil) || 0;
const secondsLeft = (game) => Math.max(0, Math.ceil((cooldownUntil(game) - Date.now()) / 1000));
const byId = (id) => list().find((g) => g.id === id) || null;

/* ------------------------------------------------------------- riot id --- */

function readRiotId() {
  try {
    const raw = JSON.parse(localStorage.getItem(RIOT_KEY) || 'null');
    return {
      name: String(raw?.name || ''),
      tag: String(raw?.tag || ''),
      region: REGIONS.includes(raw?.region) ? raw.region : 'eu',
    };
  } catch {
    return { name: '', tag: '', region: 'eu' };
  }
}

function saveRiotId() {
  const value = {
    name: el.name.value.trim(),
    tag: el.tag.value.trim(),
    region: el.region.value,
  };
  try {
    localStorage.setItem(RIOT_KEY, JSON.stringify(value));
  } catch { /* private mode */ }
  return value;
}

/* --------------------------------------------------------------- ranks --- */

/** Rank art, fetched once and only when a finalized game actually needs it. */
async function ensureTiers() {
  if (tiers) return tiers;
  tiers = await loadRankTiers();
  return tiers;
}

const rankArt = (tierId) => (tiers && tiers.get(Number(tierId))) || null;

/* ------------------------------------------------------------ rendering -- */

const dtf = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});

function slotRow(slot) {
  const icon = slot.agentIcon
    ? `<span class="gslot__icon" style="background-image:url('${esc(slot.agentIcon)}')"></span>`
    : '<span class="gslot__icon gslot__icon--blank"></span>';
  return `
    <li class="gslot">
      ${icon}
      <span class="gslot__agent">${esc(slot.agentName || '—')}</span>
      ${slot.player ? `<span class="gslot__player">${esc(slot.player)}</span>` : ''}
    </li>`;
}

function teamColumn(label, side, tick) {
  return `
    <div class="gteam gteam--${tick}">
      <h4 class="gteam__name">${esc(label)}</h4>
      <ul class="gteam__list">${(side || []).map(slotRow).join('')}</ul>
    </div>`;
}

/** The scoreline and per-player stats, once a game has real data attached. */
function matchBlock(game) {
  const m = game.match;
  if (!m) return '';

  const row = (p) => {
    const art = rankArt(p.tierId);
    return `
      <tr>
        <td class="gstat__who">
          <span class="gstat__agent">${esc(p.agentName || '')}</span>
          <span class="gstat__name">${esc(p.name)}</span>${
            String(p.tag || '').trim() ? `<span class="riottag">#${esc(p.tag)}</span>` : ''}
        </td>
        <td>
          <span class="gstat__rank">
            ${art?.icon
              ? `<img class="gstat__rankicon" src="${esc(art.icon)}" alt="" loading="lazy" width="22" height="22">`
              : '<span class="gstat__rankicon gstat__rankicon--none"></span>'}
            <span>${esc(p.rank || art?.name || 'Unranked')}</span>
          </span>
        </td>
        <td class="gstat__num">${p.acs ?? '—'}</td>
        <td class="gstat__num">${p.kills ?? '—'}/${p.deaths ?? '—'}/${p.assists ?? '—'}</td>
      </tr>`;
  };

  const side = (label, players, tick) => `
    <div class="gstatwrap">
      <h4 class="gteam__name gteam--${tick}">${esc(label)}</h4>
      <table class="gstat">
        <thead>
          <tr>
            <th>Player</th><th>Rank</th>
            <th class="gstat__num">ACS</th><th class="gstat__num">K/D/A</th>
          </tr>
        </thead>
        <tbody>${(players || []).map(row).join('')}</tbody>
      </table>
    </div>`;

  const won = (a, b) => (a > b ? 'is-win' : a < b ? 'is-loss' : '');

  return `
    <div class="gmatch">
      <div class="gmatch__score">
        <b class="${won(m.scoreA, m.scoreB)}">${esc(m.scoreA)}</b>
        <i>:</i>
        <b class="${won(m.scoreB, m.scoreA)}">${esc(m.scoreB)}</b>
      </div>
      ${m.source === 'manual' ? '<p class="gmatch__src">Entered by hand</p>' : ''}
      <div class="gmatch__sides">
        ${side('Defenders', m.playersA, 'a')}
        ${side('Attackers', m.playersB, 'b')}
      </div>
    </div>`;
}

/**
 * The rank control: a button that looks like a filled row cell and opens the
 * shared popover. Not a <select>, because a select cannot show the emblems —
 * and the emblems are how anyone actually recognises a rank.
 */
function rankCell(team, i, tierId) {
  const art = rankArt(tierId);
  const id = tierId === null || tierId === undefined || tierId === '' ? '' : String(tierId);
  return `
    <button type="button" class="rankpick" data-rank data-t="${team}" data-i="${i}"
            data-tier="${esc(id)}" aria-haspopup="dialog" aria-expanded="false">
      ${art?.icon
        ? `<img class="rankpick__thumb" src="${esc(art.icon)}" alt="" loading="lazy">`
        : '<span class="rankpick__thumb rankpick__thumb--none"></span>'}
      <span class="rankpick__label">${esc(art?.name || 'Unranked')}</span>
      <span class="pick__caret" aria-hidden="true"></span>
    </button>`;
}

/**
 * The manual form is the results table, made editable in place.
 *
 * It used to be its own wide seven-column layout, which meant the thing you
 * filled in looked nothing like the thing you got. Same two columns, same
 * headings, same row order as `matchBlock` — only the cells become inputs.
 */
function manualForm(game) {
  const m = game.match || {};

  const row = (team, i, slot, saved) => `
    <tr>
      <td class="gstat__who">
        <span class="gstat__agent">${esc(slot.agentName || '')}</span>
        <span class="gform__id">
          <input class="gform__in gform__in--name" type="text" data-f="name"
                 data-t="${team}" data-i="${i}" maxlength="16" placeholder="Name"
                 value="${esc(saved?.name ?? slot.player ?? '')}">
          <input class="gform__in gform__in--tag" type="text" data-f="tag"
                 data-t="${team}" data-i="${i}" maxlength="5" placeholder="Tag"
                 value="${esc(saved?.tag ?? '')}">
        </span>
      </td>
      <td>${rankCell(team, i, saved?.tierId)}</td>
      <td class="gstat__num">
        <input class="gform__in gform__in--n" type="number" data-f="acs"
               data-t="${team}" data-i="${i}" min="0" max="999" placeholder="—"
               value="${esc(saved?.acs ?? '')}">
      </td>
      <td class="gstat__num">
        <span class="gform__kda">
          <input class="gform__in gform__in--k" type="number" data-f="kills"
                 data-t="${team}" data-i="${i}" min="0" max="99" placeholder="—"
                 value="${esc(saved?.kills ?? '')}"><i>/</i
          ><input class="gform__in gform__in--k" type="number" data-f="deaths"
                 data-t="${team}" data-i="${i}" min="0" max="99" placeholder="—"
                 value="${esc(saved?.deaths ?? '')}"><i>/</i
          ><input class="gform__in gform__in--k" type="number" data-f="assists"
                 data-t="${team}" data-i="${i}" min="0" max="99" placeholder="—"
                 value="${esc(saved?.assists ?? '')}">
        </span>
      </td>
    </tr>`;

  const side = (label, team, tick) => `
    <div class="gstatwrap">
      <h4 class="gteam__name gteam--${tick}">${esc(label)}</h4>
      <table class="gstat gstat--edit">
        <thead>
          <tr>
            <th>Player</th><th>Rank</th>
            <th class="gstat__num">ACS</th><th class="gstat__num">K/D/A</th>
          </tr>
        </thead>
        <tbody>
          ${(game.teams?.[team] || []).map((slot, i) =>
            row(team, i, slot, (team === 'a' ? m.playersA : m.playersB)?.[i])).join('')}
        </tbody>
      </table>
    </div>`;

  return `
    <div class="gform" data-form>
      <div class="gmatch__score gmatch__score--edit">
        <input class="gform__in gform__in--score" type="number" data-f="scoreA"
               value="${esc(m.scoreA ?? '')}" min="0" max="99" placeholder="0"
               aria-label="Defenders score">
        <i>:</i>
        <input class="gform__in gform__in--score" type="number" data-f="scoreB"
               value="${esc(m.scoreB ?? '')}" min="0" max="99" placeholder="0"
               aria-label="Attackers score">
      </div>
      <p class="gmatch__src">Defenders : Attackers, as the teams were rolled</p>

      <div class="gmatch__sides">
        ${side('Defenders', 'a', 'a')}
        ${side('Attackers', 'b', 'b')}
      </div>

      <div class="gform__foot">
        <button class="btn btn--ghost" data-act="manual-cancel"><span>Cancel</span></button>
        <button class="btn btn--ghost btn--teal" data-act="manual-save"><span>Save Result</span></button>
      </div>
    </div>`;
}

/* ------------------------------------------------------- the rank picker - */

const picker = { open: false, trigger: null, panel: null, body: null };

/** Tiers grouped by division, in tier order: Iron 1-3, Bronze 1-3, and so on. */
function tierGroups() {
  const groups = new Map();
  [...(tiers || new Map())]
    .filter(([id, t]) => id === 0 || t.icon)        // Riot ships unused tiers 1-2
    .forEach(([id, t]) => {
      const key = t.division || t.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id, ...t });
    });
  return groups;
}

function openRankPicker(trigger) {
  const current = trigger.dataset.tier === '' ? null : Number(trigger.dataset.tier);

  picker.body.innerHTML = [...tierGroups()].map(([division, list]) => `
    <div class="atile-head">
      ${list[0].icon ? `<img class="atile-head__icon" src="${esc(list[0].icon)}" alt="">` : ''}
      <span>${esc(division)}</span><i></i>
    </div>
    <div class="atile-grid atile-grid--rank">
      ${list.map((t) => `
        <button type="button" class="atile atile--rank ${t.id === current ? 'is-current' : ''}"
                data-tier="${t.id}">
          ${t.icon
            ? `<span class="atile__img atile__img--rank" style="background-image:url('${esc(t.icon)}')"></span>`
            : '<span class="atile__img atile__img--rank"></span>'}
          <span class="atile__name">${esc(t.name)}</span>
        </button>`).join('')}
    </div>`).join('');

  picker.open = true;
  picker.trigger = trigger;
  picker.panel.hidden = false;
  picker.panel.dataset.team = trigger.dataset.t;
  trigger.setAttribute('aria-expanded', 'true');
  placeRankPicker();
  picker.body.scrollTop = 0;
}

function closeRankPicker() {
  if (!picker.open) return;
  picker.open = false;
  picker.panel.hidden = true;
  picker.trigger?.setAttribute('aria-expanded', 'false');
  picker.trigger = null;
}

/** Anchor under the trigger, nudged back inside the viewport at the edges. */
function placeRankPicker() {
  if (!picker.open || !picker.trigger) return;
  const a = picker.trigger.getBoundingClientRect();
  const box = picker.panel.getBoundingClientRect();
  const gap = 6;

  let left = a.left;
  left = Math.min(left, innerWidth - box.width - 12);
  left = Math.max(12, left);

  let top = a.bottom + gap;
  if (top + box.height > innerHeight - 12) top = Math.max(12, a.top - box.height - gap);

  picker.panel.style.left = `${Math.round(left)}px`;
  picker.panel.style.top = `${Math.round(top)}px`;
}

/** Write the chosen rank back into the trigger, in place — repainting the feed
 *  would throw away every other half-typed cell. */
function chooseRank(tierId) {
  const trigger = picker.trigger;
  if (!trigger) return;

  const art = rankArt(tierId);
  trigger.dataset.tier = String(tierId);
  trigger.querySelector('.rankpick__label').textContent = art?.name || 'Unranked';

  const old = trigger.querySelector('.rankpick__thumb');
  const next = art?.icon
    ? Object.assign(document.createElement('img'), { className: 'rankpick__thumb', src: art.icon, alt: '' })
    : Object.assign(document.createElement('span'), { className: 'rankpick__thumb rankpick__thumb--none' });
  old.replaceWith(next);

  closeRankPicker();
}

function card(game) {
  const pending = game.status === PENDING;
  const when = dtf.format(new Date(game.createdAt));
  const left = secondsLeft(game);
  const working = busy === game.id;
  const editing = Boolean(game.editing);

  return `
    <article class="gcard ${pending ? 'is-pending' : 'is-matched'}" data-id="${esc(game.id)}">
      <header class="gcard__head">
        ${game.map?.icon
          ? `<span class="gcard__map" style="background-image:url('${esc(game.map.icon)}')"></span>`
          : ''}
        <div class="gcard__id">
          <h3 class="gcard__name">${esc(game.map?.name || 'Unknown map')}</h3>
          <p class="gcard__when">${esc(when)}</p>
        </div>
        <span class="gpill ${pending ? 'gpill--pending' : 'gpill--matched'}">
          ${pending ? 'Pending' : 'Matched'}
        </span>
      </header>

      ${game.match || editing ? '' : `
      <div class="gcard__teams">
        ${teamColumn('Defenders', game.teams?.a, 'a')}
        ${teamColumn('Attackers', game.teams?.b, 'b')}
      </div>`}

      ${editing ? manualForm(game) : matchBlock(game)}

      <p class="gcard__note" data-note>${esc(game.note || '')}</p>

      ${editing ? '' : `
      <footer class="gcard__foot">
        ${pending ? `
          <button class="btn btn--ghost btn--teal" data-act="finalize" ${left || working ? 'disabled' : ''}>
            <span>${working ? 'Searching…' : left ? `Retry in ${left}s` : 'Finalize'}</span>
          </button>` : ''}
        <button class="btn btn--ghost" data-act="manual">
          <span>${game.match ? 'Edit Result' : 'Enter Manually'}</span>
        </button>
        <button class="btn btn--danger" data-act="delete"><span>Delete</span></button>
      </footer>`}
    </article>`;
}

function render() {
  closeRankPicker();          // its trigger is about to be replaced
  const games = list();
  el.count.textContent = String(games.length);
  el.empty.hidden = games.length > 0;
  el.feed.innerHTML = games.map(card).join('');
  syncTicker();
}

/* ------------------------------------------------------------- cooldown -- */

function syncTicker() {
  const active = list().some((g) => cooldownUntil(g) > Date.now());
  if (active && !ticker) {
    ticker = setInterval(tick, 1000);
  } else if (!active && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function tick() {
  const games = new Map(list().map((g) => [g.id, g]));

  el.feed.querySelectorAll('.gcard').forEach((node) => {
    const btn = $('[data-act="finalize"]', node);
    if (!btn || busy === node.dataset.id) return;
    const left = secondsLeft(games.get(node.dataset.id));
    btn.disabled = left > 0;
    $('span', btn).textContent = left ? `Retry in ${left}s` : 'Finalize';
  });

  syncTicker();
}

/* --------------------------------------------------------- the lookup --- */

/**
 * Ask the server for recent matches, then pick the one that is actually this
 * game. The server never decides — it has no idea what was rolled.
 */
async function lookupMatch(game, riot) {
  let res;
  let payload;
  try {
    res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: riot.name,
        tag: riot.tag,
        region: riot.region,
        platform: 'pc',
      }),
    });
    payload = await res.json().catch(() => null);
  } catch {
    return { ok: false, reason: 'Could not reach the server. Check your connection.' };
  }

  if (!payload) {
    return { ok: false, reason: 'The server returned something unreadable.' };
  }
  if (!payload.ok) {
    return {
      ok: false,
      reason: payload.code === 'unconfigured'
        ? 'Automatic lookup is not set up on the server — use Enter Manually below.'
        : payload.reason || 'The lookup failed.',
    };
  }

  const candidates = payload.matches || [];
  const hit = candidates.find((m) => matchesGame(game, m));

  if (!hit) {
    return {
      ok: false,
      reason: candidates.length
        ? `Checked your last ${candidates.length} matches — none of them is this map with these ten agents. `
          + 'If the game just ended it may not be processed yet.'
        : 'No recent matches found for that Riot ID.',
    };
  }

  return { ok: true, match: toResult(hit, game) };
}

/**
 * Upstream match + the game we rolled → the shape the card renders.
 *
 * The one thing worth care here: which of the match's two teams is the one we
 * called Defenders. That is knowable rather than guessable — compare each
 * team's five agents to the five we rolled onto that side.
 */
function toResult(match, game) {
  const ourA = (game.teams?.a || []).map((s) => String(s.agentId || '').toLowerCase()).sort();
  const sameSet = (x, y) =>
    x.length === y.length && x.length > 0 && x.slice().sort().every((v, i) => v === y[i]);

  let teamA = match.teams?.find((t) => sameSet(t.agentIds || [], ourA));
  let teamB = match.teams?.find((t) => t !== teamA);

  // Mirror comps, or an agent-id mismatch: fall back to the order given.
  if (!teamA || !teamB) [teamA, teamB] = match.teams || [];

  const forTeam = (team) => (match.players || [])
    .filter((p) => p.teamId === team?.id)
    .map((p) => ({
      name: p.name,
      tag: p.tag,
      agentName: p.agentName,
      tierId: p.tierId,
      rank: p.tierName,
      acs: p.acs,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
    }));

  return {
    source: 'lookup',
    matchId: match.matchId,
    startedAt: match.startedAt,
    scoreA: teamA?.roundsWon ?? 0,
    scoreB: teamB?.roundsWon ?? 0,
    playersA: forTeam(teamA),
    playersB: forTeam(teamB),
  };
}

async function finalize(game) {
  const riot = saveRiotId();
  if (!riot.name || !riot.tag) {
    flash(game.id, 'Enter your Riot ID above first — the lookup needs a name and a tag.');
    return;
  }

  busy = game.id;
  render();

  const res = await lookupMatch(game, riot);
  busy = null;

  if (res.ok && res.match) {
    await ensureTiers();
    update(game.id, { status: MATCHED, match: res.match, note: '', cooldownUntil: 0 });
    render();
    return;
  }

  // Still pending. The button comes back after a minute so a lookup that is
  // simply early — the match not yet processed upstream — can be retried
  // without turning into a request loop.
  update(game.id, {
    attempts: (game.attempts || 0) + 1,
    note: res.reason || 'No matching game found yet.',
    cooldownUntil: Date.now() + COOLDOWN_MS,
  });
  render();
}

function flash(id, message) {
  const node = el.feed.querySelector(`.gcard[data-id="${CSS.escape(id)}"] [data-note]`);
  if (node) node.textContent = message;
}

/* --------------------------------------------------------- manual entry -- */

function readForm(node, game) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const get = (sel) => $(sel, node);

  const players = (team) => (game.teams?.[team] || []).map((slot, i) => {
    const f = (name) => get(`[data-f="${name}"][data-t="${team}"][data-i="${i}"]`)?.value ?? '';
    const rank = get(`[data-rank][data-t="${team}"][data-i="${i}"]`);
    const tierId = !rank || rank.dataset.tier === '' ? null : Number(rank.dataset.tier);
    return {
      name: f('name').trim() || slot.player || slot.agentName,
      tag: f('tag').trim(),
      agentName: slot.agentName,
      tierId,
      rank: rankArt(tierId)?.name || '',
      acs: num(f('acs')),
      kills: num(f('kills')),
      deaths: num(f('deaths')),
      assists: num(f('assists')),
    };
  });

  return {
    source: 'manual',
    scoreA: num(get('[data-f="scoreA"]')?.value) ?? 0,
    scoreB: num(get('[data-f="scoreB"]')?.value) ?? 0,
    playersA: players('a'),
    playersB: players('b'),
  };
}

/* ----------------------------------------------------- the view module --- */

export default {
  init(node) {
    root = node;

    // The popover is a sibling of the views, not part of this one.
    picker.panel = document.getElementById('rankPanel');
    picker.body = document.getElementById('rankBody');

    Object.assign(el, {
      feed:   $('#careerFeed', root),
      empty:  $('#careerEmpty', root),
      count:  $('#countGames', root),
      name:   $('#riotName', root),
      tag:    $('#riotTag', root),
      region: $('#riotRegion', root),
    });

    const saved = readRiotId();
    el.name.value = saved.name;
    el.tag.value = saved.tag;
    el.region.value = saved.region;

    [el.name, el.tag, el.region].forEach((input) =>
      input.addEventListener('change', saveRiotId));

    // Typing the whole thing as "Name#Tag" into the first box is the natural
    // thing to do, so split it instead of rejecting it.
    el.name.addEventListener('input', () => {
      const hash = el.name.value.indexOf('#');
      if (hash < 0) return;
      const [name, tag] = [el.name.value.slice(0, hash), el.name.value.slice(hash + 1)];
      el.name.value = name;
      el.tag.value = tag.replace(/#/g, '').slice(0, 5);
      el.tag.focus();
    });

    // Backspacing out of the tag box lands in the name box, like the in-game
    // Add Friend input.
    el.tag.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !el.tag.value) {
        el.name.focus();
        el.name.setSelectionRange(el.name.value.length, el.name.value.length);
      }
    });

    picker.body.addEventListener('click', (e) => {
      const tile = e.target.closest('.atile[data-tier]');
      if (tile) chooseRank(Number(tile.dataset.tier));
    });
    document.getElementById('rankClose').addEventListener('click', closeRankPicker);
    picker.panel.addEventListener('click', (e) => e.stopPropagation());

    document.addEventListener('pointerdown', (e) => {
      if (picker.open && !picker.panel.contains(e.target) && !e.target.closest('[data-rank]')) {
        closeRankPicker();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeRankPicker();
    });
    addEventListener('resize', placeRankPicker);
    addEventListener('scroll', placeRankPicker, true);

    el.feed.addEventListener('click', (e) => {
      const rank = e.target.closest('[data-rank]');
      if (rank) {
        if (picker.open && picker.trigger === rank) closeRankPicker();
        else openRankPicker(rank);
        return;
      }

      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const node = btn.closest('.gcard');
      const id = node?.dataset.id;
      const game = byId(id);
      if (!game) return;

      switch (btn.dataset.act) {
        case 'delete':
          remove(id);
          render();
          break;
        case 'finalize':
          finalize(game);
          break;
        case 'manual':
          // The rank chooser cannot be built without the tier list, so make
          // sure it is here before the form is painted.
          ensureTiers().then(() => {
            update(id, { editing: true });
            render();
          });
          break;
        case 'manual-cancel':
          update(id, { editing: false });
          render();
          break;
        case 'manual-save': {
          const form = $('[data-form]', node);
          update(id, {
            status: MATCHED,
            match: readForm(form, game),
            editing: false,
            note: '',
            cooldownUntil: 0,
          });
          render();
          break;
        }
        default:
          break;
      }
    });

    window.addEventListener('vr:gamecreated', () => { if (mounted) render(); });

    mounted = true;
    render();
    // Any already-finalized game needs its rank art before it can show badges.
    if (list().some((g) => g.status === MATCHED)) ensureTiers().then(render);
  },

  show() {
    mounted = true;
    render();
  },

  hide() {
    mounted = false;
    closeRankPicker();
    if (ticker) { clearInterval(ticker); ticker = null; }
  },

  route() {},
};
