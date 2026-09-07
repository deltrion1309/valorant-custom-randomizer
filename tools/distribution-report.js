/* ==========================================================================
   Distribution report.

   Runs the app's real draw paths a few thousand times on the real Math.random
   and prints what came out, so you can see the fairness rather than take the
   assertions' word for it.

     npm run report               # default 20 000 events
     npm run report -- 1000000    # any sample size, any shell

   The sample size comes from the first CLI argument, or the SAMPLES env var.
   An argument is preferred because `SAMPLES=500 npm test` is bash syntax that
   PowerShell rejects outright.

   Deliberately NOT under test/ — `node --test` treats everything in that
   directory as a test file and would swallow this output.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { pickOne, pickOther, drawDistinct } from '../public/js/random.js';

const ROOT = path.join(import.meta.dirname, '..');

/** Sample size: first CLI argument wins, then SAMPLES, then the default. */
function sampleSize() {
  const raw = process.argv.slice(2).find((a) => /^\d[\d_]*$/.test(a)) ?? process.env.SAMPLES;
  const n = Number(String(raw ?? '').replace(/_/g, ''));
  if (!Number.isFinite(n) || n < 20) return 20000;
  return Math.min(Math.floor(n), 50_000_000);
}

const N = sampleSize();

/* ------------------------------------------------------------- rosters --- */

const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')).data;

const MAPS = load('maps.fallback.json')
  .map((m) => ({ id: m.uuid, name: m.displayName }))
  .sort((a, b) => a.name.localeCompare(b.name));

const AGENTS = load('agents.fallback.json')
  .map((a) => ({ id: a.uuid, name: a.displayName, role: a.role.displayName }))
  .sort((a, b) => a.name.localeCompare(b.name));

/* --------------------------------------------------------------- output -- */

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const red = (s) => c('31', s);
const green = (s) => c('32', s);
const cyan = (s) => c('36', s);

const num = (n) => n.toLocaleString('en-US');

/** The env-var prefix trick is bash-only; PowerShell needs its own form. */
function hintCmd() {
  return process.platform === 'win32'
    ? 'npm run report -- 1000000       (PowerShell: $env:SAMPLES also works)'
    : 'npm run report -- 1000000';
}
const pct = (x) => `${(x * 100).toFixed(2)} %`;

const BAR = 26;          // bar width in characters
const EXPECTED_COL = 20; // …where a perfectly average value lands

/**
 * A bar whose length is proportional to the count, with a marker at the
 * expected length. Even distribution => every bar ends on the marker.
 */
function bar(count, expected) {
  const filled = Math.min(BAR, Math.round((EXPECTED_COL * count) / expected));
  const cells = Array.from({ length: BAR }, (_, i) => (i < filled ? '█' : ' '));
  cells[EXPECTED_COL] = cells[EXPECTED_COL] === '█' ? '┃' : '┊';
  return cells.join('');
}

/** Standardised residual — how many standard deviations from expected. */
function zScore(count, runs, p) {
  const sd = Math.sqrt(runs * p * (1 - p));
  return sd === 0 ? 0 : (count - runs * p) / sd;
}

function chiSquare(counts, expected) {
  return counts.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
}

/** Upper-tail chi-square critical value at p = 0.001 (Wilson–Hilferty). */
function critical(df) {
  const a = 2 / (9 * df);
  return df * (1 - a + 3.0902 * Math.sqrt(a)) ** 3;
}

/**
 * rows: [{ name, count, note? }]  — `note` marks a row that is excluded from
 * the uniformity check on purpose (banned map, locked agent).
 * p: probability each *included* row should be hit on any one event.
 */
function table({ title, subtitle, rows, runs, p }) {
  const live = rows.filter((r) => !r.note);
  const expected = runs * p;
  const nameW = Math.max(...rows.map((r) => r.name.length), 8);
  const cntW = `${num(runs)}`.length * 2 + 1;

  console.log('');
  console.log(bold(cyan(`  ${title}`)));
  console.log(dim(`  ${subtitle}`));
  console.log(dim(`  ${'─'.repeat(nameW + cntW + BAR + 30)}`));

  for (const r of rows) {
    const label = r.name.padEnd(nameW);
    const count = `${num(r.count)}/${num(runs)}`.padStart(cntW);

    if (r.note) {
      console.log(
        `  ${label}  ${count}  ${dim('·'.repeat(BAR))}  ${'—'.padStart(8)}  ${dim(r.note)}`
      );
      continue;
    }

    const share = r.count / runs;
    const z = zScore(r.count, runs, p);
    const drift = ((r.count - expected) / expected) * 100;
    const flag = Math.abs(z) > 4 ? (z > 0 ? red('HIGH') : red('LOW ')) : green('even');
    const driftStr = `${drift >= 0 ? '+' : ''}${drift.toFixed(1)} %`;

    console.log(
      `  ${label}  ${count}  ${dim(bar(r.count, expected))}  ` +
      `${pct(share).padStart(8)}  ${driftStr.padStart(7)}  ${flag}`
    );
  }

  const df = live.length - 1;
  const x2 = chiSquare(live.map((r) => r.count), expected);
  const crit = critical(df);
  const verdict = x2 < crit
    ? green('EVEN — no bias detected')
    : red('UNEVEN — outside the p=0.001 band');

  console.log(dim(`  ${'─'.repeat(nameW + cntW + BAR + 30)}`));
  console.log(
    `  ${'expected'.padEnd(nameW)}  ${`${num(Math.round(expected))}/${num(runs)}`.padStart(cntW)}  ` +
    dim(`${' '.repeat(EXPECTED_COL)}┊${' '.repeat(BAR - EXPECTED_COL - 1)}`) +
    `  ${pct(p).padStart(8)}`
  );
  console.log(`  chi-square ${x2.toFixed(2)} vs ${crit.toFixed(2)} limit (df ${df})  →  ${verdict}`);
}

/* ------------------------------------------------------------ map runs --- */

function mapRandomize() {
  const counts = new Map(MAPS.map((m) => [m.id, 0]));
  for (let i = 0; i < N; i += 1) {
    const m = pickOne(MAPS);
    counts.set(m.id, counts.get(m.id) + 1);
  }
  return MAPS.map((m) => ({ name: m.name, count: counts.get(m.id) }));
}

function mapReroll() {
  const counts = new Map(MAPS.map((m) => [m.id, 0]));
  let current = null;
  for (let i = 0; i < N; i += 1) {
    current = pickOther(MAPS, current);        // never the previous winner
    counts.set(current.id, counts.get(current.id) + 1);
  }
  return MAPS.map((m) => ({ name: m.name, count: counts.get(m.id) }));
}

function mapRerollWithBans(bannedNames) {
  const banned = new Set(bannedNames);
  const pool = MAPS.filter((m) => !banned.has(m.name));
  const counts = new Map(MAPS.map((m) => [m.id, 0]));
  let current = null;
  for (let i = 0; i < N; i += 1) {
    current = pickOther(pool, current);
    counts.set(current.id, counts.get(current.id) + 1);
  }
  return MAPS.map((m) => ({
    name: m.name,
    count: counts.get(m.id),
    note: banned.has(m.name) ? 'banned' : undefined,
  }));
}

/* ---------------------------------------------------------- agent runs --- */

const SLOTS = 5;

function agentRandomize() {
  const counts = new Map(AGENTS.map((a) => [a.id, 0]));
  for (let i = 0; i < N; i += 1) {
    // the two boards draw independently, exactly as roll() does
    for (let board = 0; board < 2; board += 1) {
      drawDistinct(AGENTS, SLOTS).forEach((a) => counts.set(a.id, counts.get(a.id) + 1));
    }
  }
  return AGENTS.map((a) => ({ name: a.name, count: counts.get(a.id) }));
}

function agentRerollWithLocks(lockedNames) {
  const locked = new Set(lockedNames);
  const counts = new Map(AGENTS.map((a) => [a.id, 0]));
  const pool = AGENTS.filter((a) => !locked.has(a.name));

  for (let i = 0; i < N; i += 1) {
    for (let board = 0; board < 2; board += 1) {
      drawDistinct(pool, SLOTS - lockedNames.length)
        .forEach((a) => counts.set(a.id, counts.get(a.id) + 1));
    }
  }
  return AGENTS.map((a) => ({
    name: a.name,
    count: counts.get(a.id),
    note: locked.has(a.name) ? 'locked — never drawn' : undefined,
  }));
}

function agentSlotPositions(targetName) {
  const target = AGENTS.find((a) => a.name === targetName);
  const slots = new Array(SLOTS).fill(0);
  let drawn = 0;
  for (let i = 0; i < N; i += 1) {
    const pos = drawDistinct(AGENTS, SLOTS).findIndex((a) => a.id === target.id);
    if (pos >= 0) { slots[pos] += 1; drawn += 1; }
  }
  return { rows: slots.map((n, i) => ({ name: `slot ${i + 1}`, count: n })), drawn };
}

/* ----------------------------------------------------------------- run --- */

console.log('');
console.log(dim(`  ${'═'.repeat(78)}`));
console.log(bold('   DISTRIBUTION REPORT') + dim(`   ·   ${num(N)} events per run   ·   live Math.random`));
console.log(dim(`  ${'═'.repeat(78)}`));
console.log(dim('   bars are scaled so an exactly average result lands on the ┊ marker'));
console.log(dim(`   change the sample size with:  ${hintCmd()}`));

console.log('');
console.log(bold('  ┌─ MAP SELECT ' + '─'.repeat(64)));

table({
  title: 'Randomize',
  subtitle: `${num(N)} events · ${MAPS.length} maps in the pool · every map equally likely`,
  rows: mapRandomize(),
  runs: N,
  p: 1 / MAPS.length,
});

table({
  title: 'Reroll',
  subtitle: `${num(N)} events · each roll excludes the previous winner, as the app does`,
  rows: mapReroll(),
  runs: N,
  p: 1 / MAPS.length,
});

const BANS = ['Bind', 'Icebox', 'Split'];
table({
  title: 'Reroll with bans',
  subtitle: `${num(N)} events · ${BANS.join(', ')} banned · ${MAPS.length - BANS.length} maps live`,
  rows: mapRerollWithBans(BANS),
  runs: N,
  p: 1 / (MAPS.length - BANS.length),
});

console.log('');
console.log(bold('  ┌─ AGENT SELECT ' + '─'.repeat(62)));

table({
  title: 'Randomize',
  subtitle:
    `${num(N)} events · both boards drawn, ${SLOTS} of ${AGENTS.length} each · ` +
    `${SLOTS * 2} slots filled per event`,
  rows: agentRandomize(),
  runs: N,
  p: (SLOTS * 2) / AGENTS.length,
});

const LOCKS = ['Cypher', 'Viper'];
table({
  title: 'Reroll with locks',
  subtitle:
    `${num(N)} events · ${LOCKS.join(' and ')} locked on both boards · ` +
    `${(SLOTS - LOCKS.length) * 2} open slots drawn from ${AGENTS.length - LOCKS.length} agents`,
  rows: agentRerollWithLocks(LOCKS),
  runs: N,
  p: ((SLOTS - LOCKS.length) * 2) / (AGENTS.length - LOCKS.length),
});

const target = AGENTS[Math.floor(AGENTS.length / 2)].name;
const { rows: slotRows, drawn } = agentSlotPositions(target);
table({
  title: 'Slot position',
  subtitle: `where ${target} landed on the ${num(drawn)} boards that drew them`,
  rows: slotRows,
  runs: drawn,
  p: 1 / SLOTS,
});

console.log('');
console.log(dim(`  ${'═'.repeat(78)}`));
console.log('');
