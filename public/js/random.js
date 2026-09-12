/* ==========================================================================
   Randomisation primitives.

   Kept free of DOM and network so `test/random.test.js` can hammer them
   directly. Every function takes an injectable `rng` (defaulting to
   Math.random) purely so the tests can run deterministically — the app never
   passes one.

   The contract every function upholds: given a uniform rng over [0, 1),
   each legal outcome is equally likely. That is what the distribution tests
   assert, and it is easy to break by accident (`arr.sort(() => Math.random()
   - 0.5)` is the classic trap — heavily biased, and it looks fine by eye).
   ========================================================================== */

/**
 * Uniform integer in [0, max). The rng must return [0, 1); values outside
 * that would index out of bounds, so clamp defensively.
 */
export function randomInt(max, rng = Math.random) {
  if (!Number.isInteger(max) || max <= 0) return 0;
  const i = Math.floor(rng() * max);
  return i < 0 ? 0 : i > max - 1 ? max - 1 : i;
}

/** Uniform pick from a list. Returns null for an empty list. */
export function pickOne(list, rng = Math.random) {
  if (!list || !list.length) return null;
  return list[randomInt(list.length, rng)];
}

/**
 * Uniform pick that never returns `avoid` (matched by `key`, id by default),
 * used so the carousel never shows the same thing twice in a row.
 * Falls back to the only candidate when the list can't avoid it.
 */
export function pickOther(list, avoid, rng = Math.random, key = (x) => x?.id) {
  if (!list || !list.length) return null;
  if (avoid == null) return pickOne(list, rng);
  const rest = list.filter((x) => key(x) !== key(avoid));
  return rest.length ? pickOne(rest, rng) : list[0];
}

/**
 * Fisher-Yates, unbiased: every permutation is equally likely. Returns a new
 * array; the input is untouched.
 */
export function shuffle(list, rng = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1, rng);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * `count` distinct items drawn uniformly from `pool` — the agent draw for one
 * team. Returns null when the pool is too small to fill the request, so the
 * caller can say so instead of silently handing back duplicates.
 */
export function drawDistinct(pool, count, rng = Math.random) {
  if (!pool || pool.length < count || count < 0) return null;
  return shuffle(pool, rng).slice(0, count);
}

/**
 * Deterministic rng for the tests (mulberry32). Not used by the app — the app
 * always runs on Math.random.
 */
export function seededRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ==========================================================================
   Role-balanced team composition.
   ========================================================================== */

const roleOf = (a) => (a && a.role) || 'Agent';

/** Multiset of roles, as role → count. */
function roleTally(agents) {
  const m = new Map();
  agents.forEach((a) => m.set(roleOf(a), (m.get(roleOf(a)) || 0) + 1));
  return m;
}

/**
 * Draw both teams so they end up with the SAME multiset of roles.
 *
 * The shape ("2 Duelists, 1 Initiator, 1 Controller, 1 Sentinel") is drawn once,
 * before either team is dealt, and both teams are then filled from it. Rolling
 * one team first and mirroring it onto the other would look the same but is not
 * the same: the first team would pick from the whole roster and the second only
 * from what the shape allowed. Drawing the shape up front treats both equally.
 *
 * Locked slots constrain the shape rather than being ignored by it: the shape
 * starts at the per-role maximum of what the two teams have already locked, so
 * a locked Sentinel on one side guarantees the other side gets a Sentinel too.
 *
 * Each remaining slot in the shape is drawn weighted by how many agents of that
 * role are actually in the pool, so a roster with eight Duelists and three
 * Sentinels still produces Duelist-leaning comps at the same rate pure random
 * would. Only roles that both teams can still satisfy are eligible, so the
 * shape can never be built into something one side cannot fill.
 *
 * @param {object}   opts
 * @param {object[]} opts.pool   every agent available, each with `id` and `role`
 * @param {object}   opts.teams  team key → { locked: agent[] } already on board
 * @param {number}   opts.size   slots per team (5)
 * @param {Function} [opts.rng]
 * @returns {{picks: object, shape: string[]}|null}
 *   `picks` is team key → the agents drawn for that team's OPEN slots, in a
 *   random order. null means symmetry is impossible — the locks already
 *   disagree, or the pool cannot supply a shape both teams can fill — and the
 *   caller should fall back to an unbalanced draw rather than refuse to roll.
 */
export function balancedDraw({ pool, teams, size, rng = Math.random }) {
  const keys = Object.keys(teams);
  if (!pool || !pool.length || keys.length !== 2 || !Number.isInteger(size) || size <= 0) {
    return null;
  }

  const roles = [...new Set(pool.map(roleOf))];
  const weight = new Map(roles.map((r) => [r, pool.filter((a) => roleOf(a) === r).length]));

  // What each team has locked, and what it may still draw (its own locks are
  // out; the other team's are not — customs allow the same agent on both sides).
  const held = {};
  const free = {};
  for (const k of keys) {
    const locked = teams[k].locked || [];
    if (locked.length > size) return null;
    const lockedIds = new Set(locked.map((a) => a.id));
    held[k] = roleTally(locked);
    free[k] = new Map(
      roles.map((r) => [r, pool.filter((a) => roleOf(a) === r && !lockedIds.has(a.id))])
    );
  }

  // Floor: whatever the locks already force, on either side.
  const shape = new Map(roles.map((r) => [r, 0]));
  let filled = 0;
  for (const r of roles) {
    const forced = Math.max(...keys.map((k) => held[k].get(r) || 0));
    shape.set(r, forced);
    filled += forced;
  }
  if (filled > size) return null;      // the two sides' locks cannot be reconciled

  // Fill the rest, weighted by the roster, skipping anything a team could not
  // then supply.
  while (filled < size) {
    const options = [];
    for (const r of roles) {
      const next = shape.get(r) + 1;
      const ok = keys.every((k) => free[k].get(r).length >= next - (held[k].get(r) || 0));
      if (ok) for (let i = weight.get(r); i > 0; i -= 1) options.push(r);
    }
    if (!options.length) return null;
    const r = pickOne(options, rng);
    shape.set(r, shape.get(r) + 1);
    filled += 1;
  }

  // Deal each team the difference between the shape and what it already holds.
  const picks = {};
  for (const k of keys) {
    const used = new Set();
    const drawn = [];
    for (const r of roles) {
      let need = shape.get(r) - (held[k].get(r) || 0);
      while (need > 0) {
        const agent = pickOne(free[k].get(r).filter((a) => !used.has(a.id)), rng);
        if (!agent) return null;
        used.add(agent.id);
        drawn.push(agent);
        need -= 1;
      }
    }
    // Shuffled, so a role does not always land in the same slot position.
    picks[k] = shuffle(drawn, rng);
  }

  const shapeList = [];
  roles.forEach((r) => { for (let i = shape.get(r); i > 0; i -= 1) shapeList.push(r); });

  return { picks, shape: shapeList };
}
