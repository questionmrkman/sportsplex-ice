// Cloudflare Worker that starts the "Scrape and deploy" GitHub workflow on a schedule.
// GitHub's own cron is best-effort and often skips runs; Cloudflare Cron Triggers are dependable.
// The GitHub token lives in a Worker secret (GITHUB_TOKEN) — never in this file.

const API_VERSION = '2022-11-28';

/** Ask GitHub to run the workflow. Throws (so the failure shows in Worker logs) if it doesn't accept. */
export async function dispatch(env, fetchImpl = fetch) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret is not set (run: npx wrangler secret put GITHUB_TOKEN)');

  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'fennell-ice-trigger',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: env.GITHUB_REF || 'main' }),
  });

  // GitHub answers 204 (older API) or 200 (newer, with run details) on success.
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`GitHub dispatch failed: ${res.status} ${detail}`);
  }
  return res.status;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },

  // No public surface: the Worker only does work on its cron schedule.
  async fetch() {
    return new Response('fennell-ice-trigger: runs on a schedule only', { status: 404 });
  },
};
