// Zero-dependency static server that also keeps schedule.json fresh.
//   npm start            -> http://localhost:3000
//   PORT=8080 REFRESH_MINUTES=15 npm start
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScrape, OUT_FILE } from './scraper/scrape.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(ROOT, 'site');
const PORT = Number(process.env.PORT || 3000);
const REFRESH_MS = Number(process.env.REFRESH_MINUTES || 30) * 60_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let scraping = false;
async function refresh(reason) {
  if (scraping) return;
  scraping = true;
  try {
    const r = await runScrape();
    const bad = r.sources.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`);
    console.log(`[${new Date().toLocaleTimeString()}] scrape (${reason}): ${r.slots.length} slots${bad.length ? ` — problems: ${bad.join('; ')}` : ''}`);
  } catch (err) {
    console.error('scrape failed:', err);
  } finally {
    scraping = false;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(SITE, rel));
    if (!file.startsWith(SITE + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
    await stat(file);
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

// Scrape immediately if there's no data or it's stale, then on an interval.
const age = await stat(OUT_FILE).then((s) => Date.now() - s.mtimeMs, () => Infinity);
if (age > REFRESH_MS) await refresh('startup');
setInterval(() => refresh('interval'), REFRESH_MS).unref?.();

server.listen(PORT, () => console.log(`Fennell Ice Schedule on http://localhost:${PORT} (refreshing every ${REFRESH_MS / 60000} min)`));
