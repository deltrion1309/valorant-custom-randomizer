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
   ========================================================================== */

const ROUTES = [
  { path: '/map/ban', view: 'map',   sub: 'ban'  },
  { path: '/map',     view: 'map',   sub: 'roll' },
  { path: '/agent',   view: 'agent', sub: null   },
];

const HOME = '/map/ban';

const els = {
  map: document.getElementById('viewMap'),
  agent: document.getElementById('viewAgent'),
};

const loaders = {
  map: () => import('./map.js'),
  agent: () => import('./agent.js'),
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
  document.title = view === 'agent'
    ? 'Agent Select — Custom Randomizer'
    : 'Map Select — Custom Randomizer';
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

  if (replace) history.replaceState({}, '', route.path);
  else history.pushState({}, '', route.path);

  return render(route);
}

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
