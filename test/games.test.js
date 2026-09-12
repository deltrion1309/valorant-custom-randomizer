/* ==========================================================================
   The game log: identity, and the rules that decide whether a fetched match
   really is the game we set up.

   `matchesGame` is the one place where a wrong answer is expensive — writing
   somebody else's match into your own history is worse than showing nothing —
   so it gets tested the way the randomness does: against the ways it could
   plausibly be too permissive.
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  signature, composition, compositionNames, matchesGame, MATCH_WINDOW,
} from '../public/js/games.js';

const AT = Date.parse('2026-09-11T20:00:00Z');

function game({ map = 'Ascent', a = ['a1', 'a2', 'a3', 'a4', 'a5'], b = ['b1', 'b2', 'b3', 'b4', 'b5'] } = {}) {
  const side = (ids) => ids.map((id, i) => ({ slot: i, agentId: id, agentName: `Agent ${id}`, player: '' }));
  return { id: 'g1', createdAt: AT, status: 'PENDING', map: { id: `m-${map}`, name: map }, teams: { a: side(a), b: side(b) } };
}

const match = (over = {}) => ({
  map: 'Ascent',
  agentIds: [...composition(game())],
  agentNames: [...compositionNames(game())],
  startedAt: AT + 5 * 60 * 1000,
  ...over,
});

/* ------------------------------------------------------------- identity -- */

test('signature ignores which team an agent landed on but not who was picked', () => {
  const base = game();
  const swapped = game({ a: ['b1', 'b2', 'b3', 'b4', 'b5'], b: ['a1', 'a2', 'a3', 'a4', 'a5'] });
  const different = game({ a: ['a1', 'a2', 'a3', 'a4', 'zz'] });

  assert.equal(signature(base), signature(game()), 'same line-up must sign the same');
  assert.notEqual(signature(base), signature(swapped), 'sides matter');
  assert.notEqual(signature(base), signature(different), 'one different agent must change it');
});

test('signature survives slots being reordered within a team', () => {
  const a = game();
  const b = game({ a: ['a5', 'a4', 'a3', 'a2', 'a1'] });
  assert.equal(signature(a), signature(b));
});

/* --------------------------------------------------------- verification -- */

test('a match with the right map, composition and timing is accepted', () => {
  assert.equal(matchesGame(game(), match()), true);
});

test('the map must be the same one', () => {
  assert.equal(matchesGame(game(), match({ map: 'Haven' })), false);
});

test('map comparison is case- and whitespace-insensitive', () => {
  assert.equal(matchesGame(game(), match({ map: '  ascent ' })), true);
});

test('all ten agents must match — nine out of ten is a different game', () => {
  // Both identities have to be wrong for this to be a different lobby: one
  // service disagreeing on a uuid is not evidence that the game is not yours.
  const nearly = match({
    agentIds: [...composition(game()).slice(0, 9), 'someone-else'],
    agentNames: [...compositionNames(game()).slice(0, 9), 'someone else'],
  });
  assert.equal(matchesGame(game(), nearly), false);
});

test('a shorter or longer agent list is rejected rather than partially matched', () => {
  assert.equal(matchesGame(game(), match({
    agentIds: composition(game()).slice(0, 9),
    agentNames: compositionNames(game()).slice(0, 9),
  })), false);
  assert.equal(matchesGame(game(), match({
    agentIds: [...composition(game()), 'extra'],
    agentNames: [...compositionNames(game()), 'extra'],
  })), false);
});

test('agent order does not matter — only the set of ten', () => {
  assert.equal(matchesGame(game(), match({
    agentIds: composition(game()).slice().reverse(),
    agentNames: compositionNames(game()).slice().reverse(),
  })), true);
});

test('matches outside the time window are rejected', () => {
  assert.equal(matchesGame(game(), match({ startedAt: AT - MATCH_WINDOW.before - 1000 })), false);
  assert.equal(matchesGame(game(), match({ startedAt: AT + MATCH_WINDOW.after + 1000 })), false);
  // An identical rematch a week later must not be claimed by this entry.
  assert.equal(matchesGame(game(), match({ startedAt: AT + 7 * 24 * 3600 * 1000 })), false);
});

test('the window is inclusive at both edges', () => {
  assert.equal(matchesGame(game(), match({ startedAt: AT - MATCH_WINDOW.before })), true);
  assert.equal(matchesGame(game(), match({ startedAt: AT + MATCH_WINDOW.after })), true);
});

test('a missing or unparseable timestamp is rejected, not assumed to be now', () => {
  assert.equal(matchesGame(game(), match({ startedAt: undefined })), false);
  assert.equal(matchesGame(game(), match({ startedAt: 'yesterday' })), false);
});

test('null inputs never claim a match', () => {
  assert.equal(matchesGame(null, match()), false);
  assert.equal(matchesGame(game(), null), false);
  assert.equal(matchesGame(game(), {}), false);
});


/* ------------------------------------- the two agent identities in play --- */

test('agent names carry the match when the uuids are missing', () => {
  // The match service supplies names but no ids (or ids we do not recognise).
  const m = match();
  delete m.agentIds;
  assert.equal(matchesGame(game(), m), true);
});

test('agent names carry the match when the uuids disagree', () => {
  // Two services that both know the agents but no longer agree on ids: the
  // names are the thing a human would check, so they win.
  assert.equal(matchesGame(game(), match({ agentIds: Array(10).fill('unknown-uuid') })), true);
});

test('matching uuids carry the match when the names disagree', () => {
  assert.equal(matchesGame(game(), match({ agentNames: Array(10).fill('mystery') })), true);
});

test('both identities disagreeing is still a rejection', () => {
  assert.equal(matchesGame(game(), match({
    agentIds: Array(10).fill('unknown-uuid'),
    agentNames: Array(10).fill('mystery'),
  })), false);
});

test('a match with no agent information at all never claims a game', () => {
  const m = match();
  delete m.agentIds;
  delete m.agentNames;
  assert.equal(matchesGame(game(), m), false);
  assert.equal(matchesGame(game(), match({ agentIds: [], agentNames: [] })), false);
});
