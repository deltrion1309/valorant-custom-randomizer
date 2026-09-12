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
| `/career` | Game log — every custom game this browser has set up |
| `/imprint` | Impressum (§ 5 DDG) |
| `/privacy` | Datenschutzerklärung (Art. 13 DSGVO) |

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

## Balanced compositions

By default both teams are dealt the **same multiset of roles**. The shape —
"2 Duelists, 1 Initiator, 1 Controller, 1 Sentinel" — is drawn once, before
either team is filled, and both teams are then dealt from it. Rolling one team
first and mirroring it onto the other would look identical but is not: the first
team would pick from the whole roster and the second only from what the shape
allowed. Drawing the shape up front treats both sides equally.

Locked slots constrain the shape rather than being ignored by it — the shape
starts at the per-role maximum of what the two teams have already locked, so a
locked Sentinel on one side guarantees the other side gets one too. Each
remaining slot is drawn weighted by how many agents of that role are actually in
the pool, so a Duelist-heavy roster still yields Duelist-leaning comps at the
same rate pure random would.

`Full Random` (off by default) skips all of it and draws each team
independently. The setting persists per browser.

The whole thing is `balancedDraw` in `js/random.js` — DOM-free, injectable rng,
and tested. If symmetry is genuinely impossible (the two sides' locks disagree,
or the roster is too thin) it returns `null` and the caller falls back to the
independent draw rather than refusing to roll.

Note that the same agent may legitimately appear on **both** teams: Valorant
enforces agent uniqueness within a team, not across the lobby.

## The ranked pool

The `Ranked Pool` control has three states, and all three are **derived from the
ban set** on every sync rather than remembered — so banning a map by hand drops
the control into the matching state without any second source of truth that
could disagree with the board.

| Selection | Button | A click does |
|---|---|---|
| anything else | unlit | ban the non-rotation maps → **Ranked** |
| exactly the rotation | lit teal | ban the rotation instead → **Non-Ranked** |
| exactly the non-rotation maps | lit teal, struck through | back to the rotation → **Ranked** |

The label never changes text, so the control's footprint is identical in all
three states and the head row cannot shift between them. The randomizer stage
carries a read-only twin of the same box.

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
  js/random.js             shuffle / pick / draw / balancedDraw — pure, injectable rng
  js/session.js            the bridge: locked map + locked agents → a game object
  js/games.js              the game log and the match-verification rules
  js/career.js             /career view
  js/legal.js              /imprint and /privacy, DE + EN, from data/imprint.json
api/match.js               match-lookup proxy — the Vercel function AND the dev route
.env.example               names the one environment variable; never the value
  css/fonts.css            self-hosted @font-face (see "Fonts and privacy")
  css/career.css           career view + the "game logged" toast
  css/legal.css            the two legal pages
  data/imprint.json        operator details — FILL THIS IN, see below
  fonts/                   the three OFL typefaces, served from this origin
  robots.txt, sitemap.xml, og-card.png
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


## The game log

**The map locks itself.** Rolling one commits it; rerolling replaces it. There
is no button, because there was never a decision to make — the map on the hero
is the map of the next game, always.

Locking all ten agents is therefore the only trigger, and logging a game
**releases every agent lock again**, so the app is set up for the next custom
game the instant the last one is recorded. The map is deliberately kept: roll a
new line-up and it is logged against the same map, or reroll the map first.

`session.js` is the only thing that sees both halves — the two view modules
never see each other — and it latches when both are in, writing a `PENDING`
entry through `games.js` and firing `vr:gamecreated` for the shell to toast and
for the agent view to unlock against. The latch is re-entrancy guarded, since
that unlocking calls straight back into it.

Storage is `localStorage`, so the log is per-browser: it does not follow you to
another device, and clearing site data clears it. An identical line-up logged
twice within 15 seconds is treated as one game — that catches a lock event
firing twice, while still letting you genuinely replay the same comp later.

## Finalizing a game

Two paths, sharing everything downstream of the lookup.

**Automatic.** `POST /api/match` — a serverless function — fetches your recent
matches from the [HenrikDev API](https://docs.henrikdev.xyz) and returns them
normalized. It runs on the server for two reasons: the API key would otherwise
be in the page source for anyone to take, and the upstream sends no CORS
headers. Because the browser only ever talks to this origin there is no
preflight and no cross-origin request at all.

The function deliberately does **not** decide which match is yours — it has no
idea what was rolled. `career.js` does, using `matchesGame()` from `games.js`:
the map, the exact ten agents, and a start time inside the window either side of
when the game was logged. That rule is pure and unit-tested, and a wrong match
written into the log is worse than no match, so the decision never leaves the
place it can be tested.

Agent identity is checked two ways. The board learns agents from valorant-api
and the match from a different service; today both use Riot's uuids, but a match
that is right should not be rejected the day one of them stops, so agreement on
*either* uuids or names is enough. Which of the match's two teams is "Defenders"
is likewise derived rather than guessed — compare each team's five agents to the
five we rolled onto that side.

> tracker.gg was the original plan and is not viable: their own developer FAQ
> prohibits scraping ("We will block you, and if you persist, we will get legal
> involved") and says they are not permitted to offer a Valorant API at all.

**Manual.** *Enter Manually* opens a form pre-filled with the line-up already
known — score, plus name, tag, ACS and K/D/A per player. Always available, and
the only path when the lookup is unconfigured, rate-limited, or simply cannot
find the game. It is also how you correct a lookup that got something wrong.

Rank badges come from `valorant-api.com/v1/competitivetiers` (the newest
episode's tiers — the early ones have null icons), which is an API the footer
already names.

### The API key

Set **`HENRIK_API_KEY`** in Vercel → Project → Settings → Environment Variables.
Get one from [the HenrikDev dashboard](https://api.henrikdev.xyz/dashboard); the
free Basic tier is instant and allows 30 requests per minute.

Locally, in PowerShell, in this folder:

```powershell
$env:HENRIK_API_KEY = "HDEV-..."
node server.js
```

`server.js` imports the same function Vercel runs, so local dev cannot quietly
diverge from production. With no key set the endpoint reports itself
unconfigured and the UI points at manual entry — exactly what a deploy with a
missing variable does. **The key is never in the repo**: `.gitignore` covers
`.env*`, and `.env.example` documents the name only.

## Fonts and privacy

The fonts are **self-hosted**, not loaded from `fonts.googleapis.com`. Loading
them from Google sends every visitor's IP to a US server before the page
renders; German courts have treated that as an unconsented transfer under the
GDPR and it set off a wave of warning letters. Serving them from this origin
removes the transfer and is faster besides.

All three families are SIL OFL 1.1 — `public/fonts/OFL.txt` carries the notices.
Only the `latin` subset and only the weights actually used are shipped; adding a
weight means adding a file, not just a number in `fonts.css`.

## Legal pages

`/imprint` and `/privacy` render from **`public/data/imprint.json`**. Fill in
`name`, `street`, `postalCode`, `city` and `email` and redeploy. While any of
those is blank both pages show a loud unfinished-notice instead of a plausible
blank, so an empty Impressum cannot ship by accident.

Germany's §5 DDG applies to *geschäftsmäßige* digital services, and profit is
explicitly irrelevant — the state media authorities' 2024 guidance covers any
public offering beyond "exclusively personal or family purposes". The address
must be *ladungsfähig*: a real street address where post can be served, not a
P.O. box. This is not legal advice.

**Both pages exist in German and English.** § 5 DDG binds the operator, not the
site's language: an operator based in Germany owes a German Impressum whatever
language the site is written in, and German visitors — the ones the rule exists
to protect — look for the word *Impressum*. So German is the authoritative text,
always one click away and labelled as such in the footer. English is a
translation offered alongside it, and the page opens in whichever language the
visitor's browser asks for, with the toggle remembered.

("Legal Notice" is the right English term, incidentally. "Imprint" is a false
friend borrowed from print publishing.)

## Scrollbars

Styled once, globally, in `base.css` — thin, palette-matched, inset via
`background-clip`, red while dragging. The default chrome scrollbar is a
light-grey slab that looks pasted onto a dark UI, and there are four places one
can appear (career feed, legal pages, agent picker, ban grid), so doing it per
component would mean forgetting one. `scrollbar-gutter: stable` on the scrolling
containers keeps the bar from changing the content width when it appears — the
no-layout-shift rule applied to one more thing.

## The lit-button effect

`.btn--teal.is-on` is the Ranked Pool control and the Full Random toggle. The
first version breathed the fill between two greens, which at a glance just read
as *the colour is wrong*. Valorant's own UI does not pulse by dimming things —
it wipes them: a hard-edged band of light crosses a panel, then the panel sits
still. So the fill now carries three background layers — a diagonal sheen that
crosses in the first fifth of the cycle and rests off-screen for the remainder,
a fine scanline texture, and the teal — and only `background-position` and an
inset shadow animate. The pause is the point: a continuous shimmer reads as a
loading state, an occasional wipe reads as powered-on.

Both the sheen and the edge glow live on `::after`, because `::after` is the top
opaque layer — `::before` sits underneath it and is invisible while lit, so
anything animated there would never be seen. The glow is inset for the same
reason outer shadows are avoided everywhere else here: `overflow: hidden` plus
the `clip-path` would eat one.
