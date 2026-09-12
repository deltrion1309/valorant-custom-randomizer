/* ==========================================================================
   Router.

   One document, two views. Switching between Maps and Agents shows and hides
   sections that are already in the DOM — no navigation, no reload, and each
   view keeps its state (bans, the board, the map on screen) while it is away.

   Routes:
     /            → /map/ban
     /map/ban     map view, ban stage
     /map         map view, randomizer stage
     /agent       agent view
     /career      career view, the log of games this browser has set up
     /imprint     legal view, Impressum
     /privacy     legal view, Datenschutzerklärung
   ========================================================================== */

const SITE = 'https://vcr.schwer-eingeschraenkt.com';

/**
 * Each route carries the metadata a crawler and a link preview need. The whole
 * site is one document, so without this every route would share index.html's
 * title and description — four URLs that look identical to a search engine.
 */
const ROUTES = [
  {
    path: '/map/ban',
    view: 'map',
    sub: 'ban',
    title: 'Map Ban — Custom/Randomizer',
    desc: 'Ban the maps you do not want to play, or filter straight down to the current competitive rotation, before rolling a random Valorant map.',
  },
  {
    path: '/map',
    view: 'map',
    sub: 'roll',
    title: 'Map Select — Custom/Randomizer',
    desc: 'Roll a uniformly random Valorant map from the maps left active after banning.',
  },
  {
    path: '/agent',
    view: 'agent',
    sub: null,
    title: 'Agent Select — Custom/Randomizer',
    desc: 'Deal a random Valorant agent to all ten players across both teams, with no duplicates, optional role balancing and per-slot locking.',
  },
  {
    path: '/career',
    view: 'career',
    sub: null,
    title: 'Career — Custom/Randomizer',
    desc: 'Every custom game this browser has set up: the map, both team compositions, and the result once the match is finalized.',
  },
  {
    path: '/imprint',
    view: 'legal',
    sub: 'imprint',
    title: 'Impressum · Legal Notice — Custom/Randomizer',
    desc: 'Anbieterkennzeichnung nach § 5 DDG. Provider identification under German law, in German and English.',
  },
  {
    path: '/privacy',
    view: 'legal',
    sub: 'privacy',
    title: 'Datenschutz · Privacy — Custom/Randomizer',
    desc: 'Informationen nach Art. 13 DSGVO, in Deutsch und Englisch. Keine Cookies, kein Tracking, keine Werbung.',
  },
];

const HOME = '/map/ban';

const els = {
  map: document.getElementById('viewMap'),
  agent: document.getElementById('viewAgent'),
  career: document.getElementById('viewCareer'),
  legal: document.getElementById('viewLegal'),
};

const loaders = {
  map: () => import('./map.js'),
  agent: () => import('./agent.js'),
  career: () => import('./career.js'),
  legal: () => import('./legal.js'),
};

const modules = {};      // view name → module namespace, once initialised
const booting = {};      // view name → in-flight init promise
let current = null;      // the route currently on screen

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------- routing - */

function resolve(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return ROUTES.find((r) => r.path === clean) || null;
}

/** Cross-fade the DOM change when the browser can, otherwise just do it. */
function transition(apply) {
  if (reduceMotion || !document.startViewTransition) { apply(); return; }
  document.startViewTransition(apply);
}

function setNav(view) {
  document.querySelectorAll('.nav__link').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.view === view);
  });
}

/** Keep <head> honest about which route is on screen. Crawlers that execute JS
 *  read the updated tags; the ones that do not still get index.html's defaults,
 *  which describe the site as a whole. */
function setMeta(route) {
  document.title = route.title;
  const url = SITE + route.path;

  const set = (selector, attr, value) => {
    const node = document.head.querySelector(selector);
    if (node) node.setAttribute(attr, value);
  };

  set('link[rel="canonical"]', 'href', url);
  set('meta[name="description"]', 'content', route.desc);
  set('meta[property="og:url"]', 'content', url);
  set('meta[property="og:title"]', 'content', route.title);
  set('meta[property="og:description"]', 'content', route.desc);
  set('meta[name="twitter:title"]', 'content', route.title);
  set('meta[name="twitter:description"]', 'content', route.desc);
}

async function ensure(view) {
  if (modules[view]) return modules[view];
  if (!booting[view]) {
    booting[view] = loaders[view]().then(async (mod) => {
      await mod.default.init(els[view], { navigate });
      modules[view] = mod.default;
      return mod.default;
    });
  }
  return booting[view];
}

/**
 * Show a route. The view sections are already in the document, so the swap is
 * a synchronous class flip — which is exactly what startViewTransition needs.
 */
async function render(route) {
  const prev = current;
  current = route;
  setNav(route.view);
  setMeta(route);

  // Loading a view for the first time can take a moment (data + image
  // preload); reveal its own loading state immediately so the switch still
  // feels instant.
  const first = !modules[route.view];
  const ready = ensure(route.view);

  const showView = () => {
    for (const [name, node] of Object.entries(els)) node.hidden = name !== route.view;
  };

  if (prev?.view !== route.view) {
    transition(showView);
    if (prev && modules[prev.view]) modules[prev.view].hide?.();
  }

  const mod = await ready;
  if (current !== route) return;          // navigated away while loading

  if (first) showView();
  mod.show?.();
  mod.route?.(route.sub, { navigate });
}

export function navigate(path, { replace = false } = {}) {
  const route = resolve(path);
  if (!route) return navigate(HOME, { replace: true });
  if (current && current.path === route.path) return undefined;

  if (route.view === 'career') hideToast();

  if (replace) history.replaceState({}, '', route.path);
  else history.pushState({}, '', route.path);

  return render(route);
}

/* ------------------------------------------------------------------ toast - */

/**
 * A game is logged from session.js, which can fire while the user is looking at
 * either randomizer — so the confirmation lives out here in the shell rather
 * than in a view. It carries the only navigation that matters at that moment.
 */
const toast = {
  node: document.getElementById('toast'),
  text: document.getElementById('toastText'),
  close: document.getElementById('toastClose'),
  timer: null,
};

function showToast(game) {
  if (!toast.node) return;
  const map = game?.map?.name || 'Custom game';
  toast.text.textContent = `${map} · 10 agents locked in`;
  toast.node.hidden = false;
  // Restart the entrance animation even if the toast is already up.
  toast.node.classList.remove('is-in');
  void toast.node.offsetWidth;
  toast.node.classList.add('is-in');

  clearTimeout(toast.timer);
  toast.timer = setTimeout(hideToast, 9000);
}

function hideToast() {
  clearTimeout(toast.timer);
  if (!toast.node) return;
  toast.node.classList.remove('is-in');
  toast.node.hidden = true;
}

toast.close?.addEventListener('click', hideToast);
window.addEventListener('vr:gamecreated', (e) => showToast(e.detail?.game));

/* ------------------------------------------------------------- listeners - */

// Intercept in-app links so nothing ever reloads the document.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.defaultPrevented) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  if (a.target && a.target !== '_self') return;
  if (!resolve(new URL(a.href).pathname)) return;
  e.preventDefault();
  navigate(new URL(a.href).pathname);
});

window.addEventListener('popstate', () => {
  const route = resolve(location.pathname);
  render(route || resolve(HOME));
});

/* ------------------------------------------------------------------ boot - */

const start = resolve(location.pathname);
if (start) render(start);
else navigate(HOME, { replace: true });
