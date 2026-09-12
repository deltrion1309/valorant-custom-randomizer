/* ==========================================================================
   Distribution tests for the randomisation primitives.

   Run with:  npm test        (node --test test/)

   Everything here uses a seeded rng, so a pass is a pass forever — these can
   never flake. The point is not "is Math.random random", it is "does OUR code
   preserve uniformity". The classic way to break that is
   `arr.sort(() => Math.random() - 0.5)`, which looks fine by eye and is badly
   biased; `shuffle bias regression` below fails hard on it.
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  randomInt, pickOne, pickOther, shuffle, drawDistinct, balancedDraw, seededRng,
} from '../public/js/random.js';

/* --------------------------------------------------------------- helpers - */

/**
 * Pearson's chi-square against a uniform expectation.
 * X² = Σ (observed − expected)² / expected
 */
function chiSquare(counts, expected) {
  return counts.reduce((sum, o) => sum + ((o - expected) ** 2) / expected, 0);
}

/**
 * Upper-tail critical values at p = 0.001 (i.e. a fair generator exceeds these
 * about one run in a thousand). Table indexed by degrees of freedom.
 * Above 30 df we use the Wilson–Hilferty normal approximation.
 */
const CHI2_001 = {
  3: 16.27, 4: 18.47, 5: 20.52, 9: 27.88, 10: 29.59, 19: 43.82,
  22: 48.27, 24: 51.18, 29: 58.30,
};

function critical(df) {
  if (CHI2_001[df]) return CHI2_001[df];
  // Wilson–Hilferty: X²_p ≈ df · (1 − 2/(9df) + z·sqrt(2/(9df)))³ , z(0.999)=3.0902
  const a = 2 / (9 * df);
  return df * (1 - a + 3.0902 * Math.sqrt(a)) ** 3;
}

function assertUniform(counts, label) {
  const n = counts.reduce((a, b) => a + b, 0);
  const expected = n / counts.length;
  const df = counts.length - 1;
  const x2 = chiSquare(counts, expected);
  const crit = critical(df);
  assert.ok(
    x2 < crit,
    `${label}: chi-square ${x2.toFixed(2)} exceeded the p=0.001 critical value ` +
    `${crit.toFixed(2)} (df=${df}). Counts: ${counts.join(', ')} (expected ~${expected}).`
  );
  return x2;
}

const agents = Array.from({ length: 25 }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}` }));
const maps = Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, name: `Map ${i}` }));
const indexOfId = (list, item) => list.findIndex((x) => x.id === item.id);

/* ----------------------------------------------------------- randomInt --- */

test('randomInt covers every value uniformly and stays in range', () => {
  const rng = seededRng(1);
  const N = 10;
  const counts = new Array(N).fill(0);
  for (let i = 0; i < 200000; i += 1) {
    const v = randomInt(N, rng);
    assert.ok(Number.isInteger(v) && v >= 0 && v < N, `out of range: ${v}`);
    counts[v] += 1;
  }
  assertUniform(counts, 'randomInt');
});

test('randomInt clamps a badly behaved rng instead of indexing out of bounds', () => {
  assert.equal(randomInt(5, () => 0.999999999999), 4);
  assert.equal(randomInt(5, () => 1), 4);          // rng must be [0,1) but be safe
  assert.equal(randomInt(5, () => 0), 0);
  assert.equal(randomInt(0), 0);
  assert.equal(randomInt(-3), 0);
});

/* ------------------------------------------------------------- pickOne --- */

test('pickOne is uniform across the whole list', () => {
  const rng = seededRng(2);
  const counts = new Array(maps.length).fill(0);
  for (let i = 0; i < 130000; i += 1) counts[indexOfId(maps, pickOne(maps, rng))] += 1;
  assertUniform(counts, 'pickOne over 13 maps');
});

test('pickOne handles the empty and single-item cases', () => {
  assert.equal(pickOne([]), null);
  assert.equal(pickOne(null), null);
  assert.equal(pickOne([maps[0]]).id, 'm0');
});

/* ----------------------------------------------------------- pickOther --- */

test('pickOther never repeats the avoided item and is uniform over the rest', () => {
  const rng = seededRng(3);
  const avoid = maps[4];
  const counts = new Array(maps.length).fill(0);
  for (let i = 0; i < 120000; i += 1) {
    const got = pickOther(maps, avoid, rng);
    assert.notEqual(got.id, avoid.id, 'pickOther returned the avoided item');
    counts[indexOfId(maps, got)] += 1;
  }
  assert.equal(counts[4], 0);
  assertUniform(counts.filter((_, i) => i !== 4), 'pickOther over the 12 allowed maps');
});

test('pickOther degrades sanely when there is nothing else to pick', () => {
  const only = [maps[0]];
  assert.equal(pickOther(only, maps[0]).id, 'm0');   // one map left: show it again
  assert.equal(pickOther([], maps[0]), null);
});

/* ------------------------------------------------------------- shuffle --- */

test('shuffle is a permutation and leaves the input untouched', () => {
  const rng = seededRng(4);
  const input = maps.slice();
  const before = input.map((m) => m.id).join(',');
  for (let i = 0; i < 500; i += 1) {
    const out = shuffle(input, rng);
    assert.equal(out.length, input.length);
    assert.equal(new Set(out.map((m) => m.id)).size, input.length, 'duplicate after shuffle');
    assert.equal(input.map((m) => m.id).join(','), before, 'shuffle mutated its input');
  }
});

test('shuffle bias regression: every item lands in every position equally', () => {
  // The whole point of this test. A biased shuffle (e.g. sort with a random
  // comparator) puts items near their starting index far too often, which
  // shows up as a huge chi-square on the diagonal of this matrix.
  const rng = seededRng(5);
  const size = 10;
  const list = maps.slice(0, size);
  const RUNS = 60000;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));

  for (let r = 0; r < RUNS; r += 1) {
    shuffle(list, rng).forEach((item, pos) => { matrix[indexOfId(list, item)][pos] += 1; });
  }

  matrix.forEach((row, item) => assertUniform(row, `item ${item} across positions`));
  for (let pos = 0; pos < size; pos += 1) {
    assertUniform(matrix.map((row) => row[pos]), `position ${pos} across items`);
  }
});

test('shuffle produces many distinct orderings, not a handful of rotations', () => {
  const rng = seededRng(6);
  const list = maps.slice(0, 8);
  const seen = new Set();
  for (let i = 0; i < 20000; i += 1) seen.add(shuffle(list, rng).map((m) => m.id).join(''));
  // 8! = 40320 possible; 20k draws should uncover a large fraction of them.
  assert.ok(seen.size > 12000, `only ${seen.size} distinct orderings from 20000 shuffles`);
});

/* -------------------------------------------------------- drawDistinct --- */

test('drawDistinct returns the requested number of distinct items', () => {
  const rng = seededRng(7);
  for (let i = 0; i < 2000; i += 1) {
    const team = drawDistinct(agents, 5, rng);
    assert.equal(team.length, 5);
    assert.equal(new Set(team.map((a) => a.id)).size, 5, 'duplicate agent inside one team');
  }
});

test('drawDistinct refuses an impossible request rather than repeating', () => {
  assert.equal(drawDistinct(agents.slice(0, 4), 5), null);
  assert.deepEqual(drawDistinct(agents, 0), []);
  assert.equal(drawDistinct(null, 1), null);
});

test('every agent is drawn onto a team equally often', () => {
  const rng = seededRng(8);
  const RUNS = 120000;
  const counts = new Array(agents.length).fill(0);
  for (let r = 0; r < RUNS; r += 1) {
    drawDistinct(agents, 5, rng).forEach((a) => { counts[indexOfId(agents, a)] += 1; });
  }
  // 5 of 25 agents drawn per run => each agent expected in 20% of runs.
  const share = counts.map((c) => c / RUNS);
  share.forEach((s, i) => assert.ok(
    Math.abs(s - 0.2) < 0.01,
    `agent ${i} appeared in ${(s * 100).toFixed(2)}% of draws, expected ~20%`
  ));
  assertUniform(counts, 'agent draw frequency');
});

test('a drawn agent is equally likely to land in any of the five slots', () => {
  const rng = seededRng(9);
  const RUNS = 100000;
  const slots = new Array(5).fill(0);
  const target = agents[11];
  for (let r = 0; r < RUNS; r += 1) {
    const pos = drawDistinct(agents, 5, rng).findIndex((a) => a.id === target.id);
    if (pos >= 0) slots[pos] += 1;
  }
  assertUniform(slots, 'slot position of a given agent');
});

/* ---------------------------------------- the real team-draw, end to end -- */

test('locked agents are excluded and the rest stay uniform', () => {
  // Mirrors roll(): two slots locked, three open, drawn from what is left.
  const rng = seededRng(10);
  const locked = new Set([agents[0].id, agents[1].id]);
  const pool = agents.filter((a) => !locked.has(a.id));
  const RUNS = 90000;
  const counts = new Array(agents.length).fill(0);

  for (let r = 0; r < RUNS; r += 1) {
    const team = drawDistinct(pool, 3, rng);
    team.forEach((a) => {
      assert.ok(!locked.has(a.id), 'a locked agent was drawn into an open slot');
      counts[indexOfId(agents, a)] += 1;
    });
  }
  assert.equal(counts[0], 0);
  assert.equal(counts[1], 0);
  assertUniform(counts.slice(2), 'draw frequency with two agents locked out');
});

test('the two teams draw independently — mirror picks happen at chance rate', () => {
  const rng = seededRng(11);
  const RUNS = 40000;
  let mirrored = 0;
  for (let r = 0; r < RUNS; r += 1) {
    const a = new Set(drawDistinct(agents, 5, rng).map((x) => x.id));
    const b = drawDistinct(agents, 5, rng);
    if (b.every((x) => a.has(x.id))) mirrored += 1;
    assert.equal(new Set(b.map((x) => x.id)).size, 5);
  }
  // P(identical five) = 1 / C(25,5) = 1/53130 — should be vanishingly rare,
  // but crucially NOT zero-by-construction: the teams must not share a pool.
  assert.ok(mirrored <= 3, `${mirrored} full mirror comps in ${RUNS} rolls looks non-random`);
});

/* ------------------------------------- the map spin, over a long session -- */

test('a long spin session lands on every active map equally often', () => {
  const rng = seededRng(12);
  const RUNS = 130000;
  const counts = new Array(maps.length).fill(0);
  let current = null;
  for (let r = 0; r < RUNS; r += 1) {
    current = pickOther(maps, current, rng);   // spin() never repeats back-to-back
    counts[indexOfId(maps, current)] += 1;
  }
  // Excluding the previous winner each time still leaves a uniform stationary
  // distribution over a symmetric pool — every map should get ~1/13 of spins.
  assertUniform(counts, 'map spin winners across a long session');
});

test('the same map never comes up twice in a row', () => {
  const rng = seededRng(13);
  let current = null;
  for (let r = 0; r < 50000; r += 1) {
    const next = pickOther(maps, current, rng);
    if (current) assert.notEqual(next.id, current.id, 'map repeated back-to-back');
    current = next;
  }
});

/* ------------------------------------------------ the generator itself ---- */

test('Math.random itself passes the same uniformity bar (smoke test)', () => {
  // Guards against a future edit that hard-codes a bad default rng.
  const counts = new Array(20).fill(0);
  for (let i = 0; i < 200000; i += 1) counts[randomInt(20)] += 1;
  assertUniform(counts, 'randomInt on the default Math.random');
});


/* ------------------------------------------- balanced team composition ---- */

const ROLES = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

/** A roster shaped like Riot's: more Duelists than anything else. */
function roster(counts = [8, 7, 5, 6]) {
  const out = [];
  ROLES.forEach((role, r) => {
    for (let i = 0; i < counts[r]; i += 1) out.push({ id: `${role}-${i}`, name: `${role} ${i}`, role });
  });
  return out;
}

const shapeOf = (agents) => agents.map((a) => a.role).sort().join('|');
const bare = () => ({ a: { locked: [] }, b: { locked: [] } });

test('balanced draw gives both teams the same role composition', () => {
  const pool = roster();
  const rng = seededRng(7);
  for (let i = 0; i < 3000; i += 1) {
    const res = balancedDraw({ pool, teams: bare(), size: 5, rng });
    assert.ok(res, 'a full roster must always produce a balanced draw');
    assert.equal(res.picks.a.length, 5);
    assert.equal(res.picks.b.length, 5);
    assert.equal(shapeOf(res.picks.a), shapeOf(res.picks.b), 'teams differ in role shape');
  }
});

test('balanced draw never repeats an agent within a team', () => {
  const pool = roster();
  const rng = seededRng(11);
  for (let i = 0; i < 2000; i += 1) {
    const res = balancedDraw({ pool, teams: bare(), size: 5, rng });
    for (const team of ['a', 'b']) {
      assert.equal(new Set(res.picks[team].map((a) => a.id)).size, 5, `duplicate on team ${team}`);
    }
  }
});

test('locked agents are counted into the shape, not ignored by it', () => {
  const pool = roster();
  const rng = seededRng(23);
  const aLock = pool.find((x) => x.role === 'Sentinel');
  const bLock = pool.find((x) => x.role === 'Duelist');

  for (let i = 0; i < 2000; i += 1) {
    const teams = { a: { locked: [aLock] }, b: { locked: [bLock] } };
    const res = balancedDraw({ pool, teams, size: 5, rng });
    assert.ok(res);
    assert.equal(res.picks.a.length, 4, 'should only fill the four open slots');
    assert.equal(
      shapeOf([aLock, ...res.picks.a]),
      shapeOf([bLock, ...res.picks.b]),
      'final compositions differ once locks are counted'
    );
    // A locked agent must never be drawn a second time on its own team.
    assert.ok(!res.picks.a.some((x) => x.id === aLock.id));
    assert.ok(!res.picks.b.some((x) => x.id === bLock.id));
  }
});

test('the same agent may appear on both teams — customs allow it', () => {
  const pool = roster();
  const rng = seededRng(31);
  let shared = 0;
  for (let i = 0; i < 500; i += 1) {
    const res = balancedDraw({ pool, teams: bare(), size: 5, rng });
    const a = new Set(res.picks.a.map((x) => x.id));
    if (res.picks.b.some((x) => a.has(x.id))) shared += 1;
  }
  assert.ok(shared > 0, 'cross-team overlap should be possible, not engineered away');
});

test('the drawn shape follows the roster, not a flat role distribution', () => {
  // Duelists are the biggest role here by a wide margin, so they should show up
  // in the shape more often than Controllers. A flat-per-role draw would not.
  const pool = roster([12, 6, 3, 6]);
  const rng = seededRng(101);
  const seen = Object.fromEntries(ROLES.map((r) => [r, 0]));
  for (let i = 0; i < 4000; i += 1) {
    balancedDraw({ pool, teams: bare(), size: 5, rng }).shape.forEach((r) => { seen[r] += 1; });
  }
  assert.ok(seen.Duelist > seen.Controller * 2, `expected Duelist-heavy shapes, got ${JSON.stringify(seen)}`);
});

test('balanced draw bails out instead of guessing when symmetry is impossible', () => {
  const pool = roster();
  // Five locks on one side, none on the other, all Duelists: the other team
  // would need five Duelists too — fine — but six locks is over the board size.
  assert.equal(balancedDraw({ pool, teams: { a: { locked: pool.slice(0, 6) }, b: { locked: [] } }, size: 5 }), null);
  // A roster of two agents cannot fill five slots.
  assert.equal(balancedDraw({ pool: pool.slice(0, 2), teams: bare(), size: 5 }), null);
  // Four agents cannot fill five distinct slots, however the roles fall.
  assert.equal(balancedDraw({ pool: pool.slice(0, 4), teams: bare(), size: 5 }), null);
});

test('one team locking a whole role is still satisfiable — customs allow overlap', () => {
  // Every Sentinel locked on A. B can still be dealt the same Sentinels, so
  // this must succeed rather than fall back: it is the case most likely to be
  // mistaken for an impossible one.
  const pool = roster([8, 7, 5, 3]);
  const sentinels = pool.filter((a) => a.role === 'Sentinel');
  const res = balancedDraw({
    pool,
    teams: { a: { locked: sentinels }, b: { locked: [] } },
    size: 5,
    rng: seededRng(5),
  });
  assert.ok(res, 'should not bail out here');
  assert.equal(
    shapeOf([...sentinels, ...res.picks.a]),
    shapeOf(res.picks.b),
    'compositions must still match'
  );
});
