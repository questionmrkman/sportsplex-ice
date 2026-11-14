# Fennell Ice Schedule

Tracks the ice at **Susan Fennell Sportsplex** (Pads 1–4) by combining seven sources:

| Source | What it adds | Reach |
| --- | --- | --- |
| creditrivercapitals.ca | Capitals games, practices, unused ice | ~5 months |
| bramptonhockey.com | Brampton Hockey games & practices | ~5 months |
| bramptoncanadettes.com | Canadettes games & practices | ~5 months |
| silverstick.org (tournament 31575) | Silver Stick games on Pads 1–3 (Nov 20–22, 2026) | tournament dates |
| mclaughlinmedshockey.hockeyleaguestats.com | McLaughlin Meds Hockey League games (Pad 3, Sundays) | whole season |
| City of Brampton Learn to Skate (PerfectMind) | Skating lessons (3–6, 6–14, 14+, private): every session of each course | current course terms |
| City of Brampton (PerfectMind) | Public skate, shinny, figure skating | ~2 weeks |

## Run it

```bash
npm install
npm start          # http://localhost:3000 — scrapes on start, then every 30 min
```

Options: `PORT=8080 REFRESH_MINUTES=15 npm start`. One-off scrape: `npm run scrape`. Tests: `npm test`.

## How it works

- `scraper/sources.js` — parsers. Team sites are server-rendered calendars (`?Month=&Year=`); we keep only
  Fennell venues. The City widget is read through the same JSON call its own page makes.
- `scraper/scrape.js` — fetches everything and writes `site/data/schedule.json`. A source that fails is
  reported in the page footer and doesn't take down the others; an empty scrape never overwrites good data.
- `site/` — static page (no build step) that reads that JSON. Filters and the selected date live in the URL, so
  views can be shared.
- `server.js` — tiny static server that also re-runs the scraper on a timer.

## Notes

- The McLaughlin Meds league page needs a normal `Accept` header (it answers 406 to a bare request) and shows dates
  without a year; the year comes from the "2026 / 2027" season heading, so a new season means a new `sid` in the URL.
- Learn to Skate courses come from four City calendars (listed in `SOURCES`). The City publishes each course as a
  series, so every dated session becomes its own slot. Registration status is shown (all are currently "closed" —
  the term has started); lessons use the City's real start/end times.
- The Silver Stick source is tied to one tournament ID (`31575`, in `SOURCES` in `scraper/scrape.js`). For a new
  year or tournament, change that URL. Its games publish no end time, so they're drawn as 70 minutes.
- Pad naming differs per site (`Pad 2`, `Rink 4`, `SF Arena Ice (1)`); all are normalized to Pad 1–4.
- Games don't publish an end time, so they're drawn as ~90 minutes and labelled "end time not published".
- The team sites redirect months ~5 months out to a bot-check page. The scraper stops at that point rather than
  trying to get past it.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` re-scrapes and redeploys the site every 30 minutes (and on every push to `main`).
The schedule data isn't committed; it's generated fresh in CI each run.

One-time setup:

1. Create a **public** GitHub repo (Pages on private repos needs a paid plan) and push this project to `main`.
2. In the repo go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Open the **Actions** tab, pick **Scrape and deploy**, and click **Run workflow** (or just push to `main`).
   The site appears at `https://<user>.github.io/<repo>/`.

Behaviour worth knowing:

- If a scrape yields nothing (or every source fails) the workflow fails and the **previous site stays live**; the
  page's "Updated … ago" indicator turns amber after 6 hours. If only one source is down, the site still deploys and
  the footer shows which one.
- Each run's **Summary** lists per-source slot counts.
- GitHub pauses scheduled workflows after 60 days without repo activity. If that happens, re-enable it from the
  Actions tab (any push also resets the clock).
- Scheduled runs can start several minutes late; "every 30 min" is approximate.

## Reliable refresh: Cloudflare trigger

GitHub's own `schedule` cron is best-effort (it can skip runs for hours), so `trigger-worker/` holds a tiny
Cloudflare Worker that starts the "Scrape and deploy" workflow every 30 minutes via the GitHub API. The workflow's
own cron stays as a backup; overlapping runs queue one at a time.

- Deploy / update: `cd trigger-worker && npm install && npx wrangler deploy`
- Token: a fine-grained GitHub token limited to this repo with **Actions: Read and write**, stored as a Worker secret
  (never committed): `npx wrangler secret put GITHUB_TOKEN`. Tokens expire — renew it before then, or the Worker's
  runs will fail (visible with `npx wrangler tail`).
- Cloud-triggered runs show in the Actions tab as `workflow_dispatch` events.
- Tests: `cd trigger-worker && npm test`
