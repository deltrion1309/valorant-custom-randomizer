/**
 * Valorant Randomizer - tiny zero-dependency static server.
 *
 *   node server.js            -> http://localhost:3000
 *   node server.js 4000       -> http://localhost:4000
 *
 * Routes:
 *   /          -> redirect to /map/ban
 *   /map/ban   -> the shell (ban stage)
 *   /map       -> the shell (randomizer stage)
 *   /agent     -> the shell (agent select)
 *   /*         -> files under public/
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const ROOT = path.join(import.meta.dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Every app route serves the same shell; /js/app.js decides what to show.
const APP_ROUTES = new Set(['/map', '/map/ban', '/maps', '/agent', '/agents']);
const SHELL = '/index.html';

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (pathname === '/') {
    res.writeHead(302, { Location: '/map/ban' }).end();
    return;
  }

  const cleaned = pathname.replace(/\/+$/, '') || '/';
  const target = APP_ROUTES.has(cleaned) ? SHELL : pathname;

  // Resolve inside ROOT only.
  const filePath = path.join(ROOT, path.normalize(target).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<body style="background:#0f1923;color:#ece8e1;font:600 16px system-ui;padding:40px">' +
        '404 &mdash; nothing here. Try <a style="color:#ff4655" href="/map">/map</a> ' +
        'or <a style="color:#ff4655" href="/agent">/agent</a>.</body>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  VALORANT RANDOMIZER');
  console.log('  ------------------------------------');
  console.log(`  open    ->  http://localhost:${PORT}/`);
  console.log('');
  console.log('  Ctrl+C to stop.');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Try:  node server.js 3001\n`);
    process.exit(1);
  }
  throw err;
});
