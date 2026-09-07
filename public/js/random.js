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
