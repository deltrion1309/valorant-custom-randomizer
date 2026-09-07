# Valorant Randomizer

Custom-game helper: rolls a random map, and (next) random agents for both teams.
Zero dependencies — plain HTML/CSS/JS served by a ~60-line Node script.

## Run it

```bash
cd "D:\Code\Valorant Randomizer"
node server.js
```

Then open **http://localhost:3000**

Port already taken? `node server.js 3001`.
`npm start` does the same thing. No `npm install` needed — there is nothing to install.

## Tests

```
npm test                     # assertions, then a distribution report
npm run report               # just the report
npm run report -- 1000000    # any sample size, any shell
```

Note the `--`: it is how npm passes the argument through to the script. Pass the
sample size as an argument rather than as an environment variable — `SAMPLES=500
npm test` is bash syntax and PowerShell rejects it outright with
`The term 'SAMPLES=500' is not recognized`. (`$env:SAMPLES = 500` before the
command works in PowerShell, but it then sticks for the rest of the session,
which is its own small trap.) A million events takes about three seconds.

Two halves, no dependencies either side.

**`test/random.test.js`** is the regression net: that `randomInt`, `pickOne`,
`pickOther` and `shuffle` are uniform, that every agent is drawn onto a team
equally often and lands in each slot equally often, that locked agents are never
drawn, and that map spins are evenly distributed over a long session.

**`tools/distribution-report.js`** then prints what actually came out, so you can
read the fairness rather than take the assertions' word for it — a table per draw
path (map randomize, map reroll, reroll with bans, agent randomize, reroll with
locks, slot position) with counts, a bar, the share, the drift from expected and
a per-row verdict. The bars are scaled so a perfectly average result lands on the
`┊` marker: even distribution means every bar ends on the same column. It runs on
the real `Math.random`, not the seeded one, and defaults to 20 000 events per
table — enough that the bars line up. Smaller runs look ragged even when nothing
is wrong: at 500 events normal noise is ±15%. Larger runs tighten it up — at a
million, every map lands within 0.2% of expected.

It lives in `tools/`, not `test/`, because `node --test` treats every file under
`test/` as a test file and would swallow the output.

Uniformity is asserted with a Pearson chi-square test against the p=0.001
critical value, driven by a seeded PRNG — so the suite is deterministic and can
never flake. It is a real regression net, not decoration: swapping the
Fisher-Yates shuffle for the popular `arr.sort(() => Math.random() - 0.5)` makes
it fail with a chi-square of ~7900 against a threshold of 27.9.

## Routes

| URL | What |
|---|---|
| `/` | redirects to `/map/ban` |
| `/map/ban` | Ban phase |
| `/map` | Map randomizer |
| `/agent` | Agent select |

It is one page. `index.html` holds both views and `js/app.js` shows and hides
them, so switching between Maps and Agents never reloads the document — the
browser cross-fades it with a View Transition and each view keeps its state
while it is away. Real URLs and the back button still work; the server just
serves the same shell for every app route.

## Map: two stages

**1 · Ban phase** (`/map/ban`) — the whole board at once. Click any card to ban
it; banned maps go grey, crossed through and tagged `BANNED`. Maps in the current
competitive rotation carry a teal `RANKED` chip in their corner. `Ranked Pool`
bans everything outside that rotation in one click; `Activate All` / `Ban All`
are the other bulk controls.

Whenever the bans are *exactly* the non-rotation maps, a teal `RANKED POOL` badge
takes the button's place — the button has nothing left to do, so it steps aside
and the badge appears in the same slot. The badge shows on both stages and its
tooltip names the act. On the randomizer the current map also carries a `RANKED`
flag beside its status label (suppressed during a shuffle so it can't strobe). The button reads **Skip Banning** with nothing
banned and **Confirm Bans** once something is, and refuses to continue with
fewer than two maps left — the only case that gets an explanatory line.

**2 · Randomizer** (`/map`) — just the hero and the button. **Randomize** (or
press **R**) dims the page, dissolves through the pool at ~60ms/frame, eases
into a stop, then flashes and pulses on the winner; it becomes **Reroll**
afterwards. Every swap is a cross-fade, artwork and map name alike, with the
fade length tracking the frame gap. **Edit Bans** goes back to stage one with
the current bans still selected.

Between rolls the hero holds each map for 9s and dissolves to the next. Banned
maps are excluded from that idle cycle as well as the draw. Bans live in
`localStorage`, so they survive a refresh.

## Agent page

- **Defenders** (teal) and **Attackers** (red), five slots each.
- Per slot: a player-name field, an agent picker, a `LOCK` toggle, and an avatar
  box with the agent's portrait over their background art. The agent's role shows
  as an icon pinned to the avatar's corner, so it never shifts as names change
  length during a shuffle.
- The **agent picker** is a custom popover, not a native dropdown: portraits in a
  role-grouped grid, with a search box (Enter picks the first match) and a
  `Random` row at the top. Esc or a click outside closes it. It is rendered
  outside the slot on purpose — the slot's `clip-path` would clip it away.
- **Randomize** (or press **R**) shuffles every unlocked avatar at once — same
  ramp-and-settle timing and cross-fade as the map spin — and they all stop
  together. The button becomes **Reroll** afterwards. A disabled button explains
  itself in its tooltip rather than in a line of text under it.
- **Locking**: picking a specific agent from the picker locks that slot
  automatically. Locked slots keep their agent through every reroll, and that
  agent is pulled out of their own team's pool so nobody else can draw it.
- No duplicate agents inside a team. Both teams draw independently, so a mirror
  pick across teams is allowed (as it is in a real custom).
- Names, agents and locks persist in `localStorage`.

## The ranked pool

Riot publishes no API for the competitive rotation. `/v1/maps` carries no
in-rotation flag (`premierBackgroundImage` is set on every standard map, so it
can't stand in for one) and `/v1/gamemodes/queues` describes the Competitive
queue as having a "limited map pool" without ever listing it. So the rotation is
a curated list in **`public/data/ranked-pool.json`**, fetched once on load
alongside the map list and matched to the live maps by name, case-insensitively.

It degrades quietly at every step: a name that matches nothing is dropped with a
console warning, and a missing, malformed or fully-unmatched file just hides the
button — the app is otherwise unaffected.

The rotation changes roughly every act, so this is one file to edit: update
`maps`, then bump `label`, `patch` and `updated`. The label is surfaced in the
UI, so a list that has gone stale is visible rather than silently wrong.
Current contents are `V26 Act 5` / patch `13.04`, cross-checked against three
sources that agree (linked in the file).

## Data

Live from `https://valorant-api.com/v1/maps` and
`https://valorant-api.com/v1/agents?isPlayableCharacter=true` on every load. All map art
(splashes and the tall pool cards) is served straight from Riot's CDN via
`media.valorant-api.com` — nothing is redrawn or re-hosted.

Only standard 5v5 maps are shown. The endpoint also returns the tutorial,
practice range and the Skirmish/Team-Deathmatch arenas; those have no
`tacticalDescription` and no minimap, which is how they get filtered out
(`isStandardMap` in `public/js/api.js` — loosen it there if you ever want the
TDM maps in the pool).

If the API is unreachable there are two fallbacks, in order:

1. **The last live response**, cached in `localStorage` on every successful load.
   After one online visit this is always the complete, current list.
2. **The bundled snapshots** in `public/data/` — a last resort that is
   deliberately partial and may lag behind Riot's roster. The banner at the top
   of the page says which one is in use.

Both fallbacks only hold names and CDN image URLs, so art still needs the CDN.

## Nothing moves

Every control that can appear, vanish or change width sits in a fixed footprint,
because a row that slides sideways when a number drops a digit is worse than one
that is slightly less tight:

- The `Ranked Pool` button and the `RANKED POOL` badge share one grid cell
  (`.head__flag`), so the slot is as wide as the wider of the two and swapping
  which one is visible reflows nothing. They hide with `visibility`, never
  `display`. Whether the slot exists at all is decided once at load.
- The counter's number is pinned to the width of the widest value it can show.
  CSS `min-width: 2ch` isn't enough — `ch` is the width of "0" and Bebas Neue
  doesn't give every digit that width, so `12` and `7` still differed by 2.5px,
  and since the counter is the last item in a `flex: 1`-ruled row that shortfall
  slid the whole head across. `lockCounterWidth()` measures the real glyphs once
  the webfont has loaded and pins it exactly.
- The hero's `RANKED` flag and the cards' `RANKED` chips sit where nothing is to
  their right, or are absolutely positioned, so they can't push anything.

There is a headless test for this: it snapshots the bounding box of every element
in the head across badge on/off, button in/out and the count crossing the
digit boundary, and asserts zero movement.

## Fitting the screen

On anything at least 900×620 the app is a fixed-height flex column with no page
scroll: nav and footer are fixed, and whatever is in the middle — the map hero,
the ban grid, the two agent boards — takes exactly the space that is left. The
ban grid is two rows whose cards are sized off the row height; the agent boards
are five equal rows per side, with the pick and lock controls side by side on a
short screen so a row can get shorter. Vertical rhythm comes from a few `vh`
clamps in `base.css` (`--pad-y`, `--gap-y`, `--slot-av`), so the whole app
tightens up together rather than each block being hand-tuned. Below 900×620 it
falls back to ordinary flow and scrolls, which is what a phone wants.

## Layout

```
server.js                  static server; every app route serves the shell
public/
  index.html               the shell: nav, both views, the agent picker
  css/base.css             palette, type, nav, buttons, shell + fit-to-screen
  css/map.css              map page only
  css/agent.css            agent page only
  js/app.js                router: shows/hides the views, never reloads
  js/api.js                fetch + filter + cache + fallback (shared)
  js/random.js             shuffle / pick / draw — pure, injectable rng
  js/map.js                view module: ban stage, idle cycle, shuffle, reveal
  js/agent.js              view module: boards, picker, lock-in, shuffle
  data/ranked-pool.json    curated competitive rotation (see above)
  data/*.fallback.json     last-resort offline snapshots
test/random.test.js        distribution tests
```

`random.js` deliberately has no DOM or network imports so the tests can import
it straight from `public/js/`. It is the only place randomness lives; both pages
call into it.

Fonts come from Google Fonts (Bebas Neue / Oswald / Barlow — free stand-ins for
Riot's Tungsten and DIN Next). Without internet they fall back to a condensed
system font and the layout still holds.

Not affiliated with Riot Games.

## Deploying to Vercel

The app is fully static in production — `server.js` is only for local dev.
Vercel serves `public/` directly, and `vercel.json` rewrites the three app
routes to the shell so deep links and refreshes work.

1. Push this folder to a GitHub repo.
2. vercel.com → **Add New… → Project** → import that repo.
3. Framework preset **Other**. Leave the build command empty; the output
   directory is already set to `public` by `vercel.json`. Deploy.

Every push to the default branch redeploys. No env vars, no build step, no
server — it sits inside the free plan.

## Attribution

The footer carries Riot's required "Legal Jibber Jabber" notice plus an
attribution for valorant-api.com, the unofficial community API that serves the
artwork. Riot permits non-commercial fan projects on that basis, provided they
clearly disclaim endorsement — which is what the footer does. Keep it there.
