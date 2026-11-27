'use strict';
/**
 * Standalone Norton vs Other Companies dashboard — zero-dependency Node server.
 *
 * Serves public/ statically and exposes a small JSON API over data/:
 *   GET  /api/rivals            -> data/rivals.json
 *   GET  /api/norton            -> data/norton.json
 *   GET  /api/overview          -> data/overview.json (cross-company totals)
 *   GET  /api/comparison/:id    -> data/<id>.json (the company object; 404 JSON when missing)
 *   GET  /api/brokers/:company  -> data/brokers/<company>.json (surfshark|nord map to incogni;
 *                                  404 JSON when no file exists)
 *   POST /api/refresh           -> runs `node scripts/scrape.js` and returns its summary
 *
 * Refresh is MANUAL only: it runs when the dashboard's Refresh button (or
 * `node scripts/scrape.js`) is invoked. There is no scheduler and no
 * automatic or daily re-check.
 *
 * Port 3000 by default, PORT env override. Node 20+, no dependencies.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const SCRAPER = path.join(ROOT, 'scripts', 'scrape.js');

// Brokers served via Incogni's list (removal provided by Incogni).
const BROKER_ALIASES = { surfshark: 'incogni', nord: 'incogni' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJson(filePath) {
  // Returns { ok: true, data } or { ok: false, missing: true } / { ok: false, error }.
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, missing: true };
    return { ok: false, error: err.message };
  }
}

function safeId(value) {
  // Only allow simple slugs so a path can never escape data/.
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]*$/i.test(value)
    ? value.toLowerCase()
    : null;
}

// ---------------------------------------------------------------- refresh
let refreshRunning = false;
let lastRefresh = null; // { at, ok, code, summary, error }

function runScraper(source) {
  return new Promise((resolve) => {
    if (!fs.existsSync(SCRAPER)) {
      const result = {
        ok: false,
        source,
        error: 'Scraper not installed yet: scripts/scrape.js does not exist. No data was changed.',
      };
      lastRefresh = { at: new Date().toISOString(), ...result };
      resolve(result);
      return;
    }
    if (refreshRunning) {
      resolve({ ok: false, source, error: 'A refresh is already running.' });
      return;
    }
    refreshRunning = true;
    const started = Date.now();
    execFile(
      process.execPath,
      [SCRAPER],
      { cwd: ROOT, timeout: 30 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        refreshRunning = false;
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        const result = {
          ok: !err,
          source,
          code,
          durationMs: Date.now() - started,
          stdout: String(stdout || '').slice(-8000),
          stderr: String(stderr || '').slice(-8000),
        };
        if (err && err.killed) result.error = 'Scraper timed out.';
        else if (err) result.error = err.message;
        lastRefresh = { at: new Date().toISOString(), ...result };
        resolve(result);
      }
    );
  });
}

// ---------------------------------------------------------------- static
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------- routes
function handleApi(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'rivals') {
    const r = readJson(path.join(DATA_DIR, 'rivals.json'));
    if (!r.ok) {
      return sendJson(res, r.missing ? 404 : 500, {
        ok: false,
        error: r.missing ? 'data/rivals.json not found' : `Could not read data/rivals.json: ${r.error}`,
      });
    }
    return sendJson(res, 200, r.data);
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'norton') {
    const r = readJson(path.join(DATA_DIR, 'norton.json'));
    if (!r.ok) {
      return sendJson(res, r.missing ? 404 : 500, {
        ok: false,
        error: r.missing ? 'data/norton.json not found' : `Could not read data/norton.json: ${r.error}`,
      });
    }
    return sendJson(res, 200, r.data);
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'overview') {
    const r = readJson(path.join(DATA_DIR, 'overview.json'));
    if (!r.ok) {
      return sendJson(res, r.missing ? 404 : 500, {
        ok: false,
        error: r.missing ? 'data/overview.json not found' : `Could not read data/overview.json: ${r.error}`,
      });
    }
    return sendJson(res, 200, r.data);
  }

  if (req.method === 'GET' && parts.length === 3 && parts[1] === 'comparison') {
    const id = safeId(parts[2]);
    if (!id) return sendJson(res, 400, { ok: false, error: 'Invalid company id' });
    const company = readJson(path.join(DATA_DIR, `${id}.json`));
    if (!company.ok) {
      return sendJson(res, company.missing ? 404 : 500, {
        ok: false,
        error: company.missing
          ? `No data file for company "${id}" yet (data/${id}.json not found)`
          : `Could not read data/${id}.json: ${company.error}`,
      });
    }
    return sendJson(res, 200, company.data);
  }

  if (req.method === 'GET' && parts.length === 3 && parts[1] === 'brokers') {
    const id = safeId(parts[2]);
    if (!id) return sendJson(res, 400, { ok: false, error: 'Invalid company id' });
    const fileId = BROKER_ALIASES[id] || id;
    const r = readJson(path.join(DATA_DIR, 'brokers', `${fileId}.json`));
    if (!r.ok) {
      return sendJson(res, r.missing ? 404 : 500, {
        ok: false,
        error: r.missing
          ? `No broker list file for "${id}" (data/brokers/${fileId}.json not found)`
          : `Could not read data/brokers/${fileId}.json: ${r.error}`,
      });
    }
    return sendJson(res, 200, r.data);
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'refresh') {
    // Drain any request body, then run the scraper.
    req.resume();
    req.on('end', () => {
      runScraper('manual').then((result) => {
        sendJson(res, result.ok ? 200 : result.error && result.error.includes('not installed') ? 503 : 200, result);
      });
    });
    return;
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'refresh-status') {
    return sendJson(res, 200, {
      running: refreshRunning,
      scraperInstalled: fs.existsSync(SCRAPER),
      lastRefresh,
    });
  }

  return sendJson(res, 404, { ok: false, error: `Unknown API route: ${req.method} ${pathname}` });
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      handleApi(req, res, url.pathname);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url.pathname);
    } else {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method not allowed');
    }
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Norton vs Other Companies dashboard running at http://localhost:${PORT}`);
  console.log(`Scraper ${fs.existsSync(SCRAPER) ? 'found' : 'not installed yet'}: ${SCRAPER}`);
  console.log('Refresh is manual only — use the dashboard Refresh button or `node scripts/scrape.js`.');
});
