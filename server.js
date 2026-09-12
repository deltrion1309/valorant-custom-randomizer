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
 *   /api/match -> the match-lookup proxy, same code Vercel runs
 *   /*         -> files under public/
 *
 * The proxy needs a key. PowerShell, in this folder, before starting:
 *   $env:HENRIK_API_KEY = "HDEV-..."
 *   node server.js
 * Without it the endpoint reports itself unconfigured and the UI falls back to
 * manual entry, which is exactly what a deploy with no key set would do.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { lookup } from './api/match.js';

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
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// Every app route serves the same shell; /js/app.js decides what to show.
const APP_ROUTES = new Set([
  '/map', '/map/ban', '/maps', '/agent', '/agents',
  '/career', '/imprint', '/privacy',
]);
const SHELL = '/index.html';

async function handleMatch(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, code: 'method', reason: 'POST only.' }));
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) {                 // nothing legitimate is this big
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, code: 'too_large', reason: 'Request too large.' }));
      return;
    }
    chunks.push(chunk);
  }

  let body = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, code: 'bad_json', reason: 'Body must be JSON.' }));
    return;
  }

  const { status, body: out } = await lookup(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(out));
}

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

  // The one dynamic route. Kept byte-identical to the deployed function by
  // importing it, so local dev cannot quietly diverge from production.
  if (pathname === '/api/match') {
    handleMatch(req, res);
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
