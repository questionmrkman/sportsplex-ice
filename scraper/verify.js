// CI gate: fail the build (so the previous good site stays live) when the scrape
// produced nothing usable. Partial failures (one source down) are allowed but reported.
import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'data', 'schedule.json');

let data;
try {
  data = JSON.parse(await readFile(file, 'utf8'));
} catch (err) {
  console.error(`No usable schedule.json (${err.message}); refusing to deploy.`);
  process.exit(1);
}

const failed = data.sources.filter((s) => !s.ok);
const lines = [
  '### Scrape result',
  `${data.slots.length} slots, generated ${data.generatedAt}`,
  '',
  ...data.sources.map((s) => `- ${s.ok ? '✅' : '❌'} ${s.name}: ${s.ok ? `${s.count} slots${s.note ? ` (${s.note})` : ''}` : s.error}`),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');

if (data.slots.length === 0) {
  console.error('Schedule is empty; refusing to deploy.');
  process.exit(1);
}
// Every source down but stale-looking data present would be suspicious too.
if (failed.length === data.sources.length) {
  console.error('All sources failed; refusing to deploy.');
  process.exit(1);
}
if (failed.length) console.log(`::warning::${failed.length} source(s) failed: ${failed.map((s) => s.name).join(', ')}`);
