# codex-engine

The system that posts to LinkedIn for me.

Part of [Codex](https://codex-os.vercel.app) — an AI operating system for growth teams. This repo is the operator's LinkedIn publishing module: posts live as markdown in `posts/`, a GitHub Action publishes the day's file to LinkedIn at a fixed UTC time using the LinkedIn API.

```
posts/2026-05-22.md  →  GitHub Action @ 14:00 UTC  →  LinkedIn /rest/posts  →  feed
```

## How it works

- **Source of truth:** `posts/YYYY-MM-DD.md` files. One file per scheduled post. Frontmatter controls visibility and status.
- **Scheduler:** `.github/workflows/post-daily.yml` runs at 14:00 UTC (11:00 AR). Manually triggerable too.
- **Publishing:** `scripts/post.ts` refreshes the LinkedIn access token, then calls the Posts API.
- **Tokens:** stored as GitHub Secrets. Refresh token has ~1-year lifespan, access token gets minted fresh per run.

## Setup (one-time)

1. **Register a LinkedIn Developer App** at https://www.linkedin.com/developers/apps and add products: `Sign In with LinkedIn using OpenID Connect` + `Share on LinkedIn`.
2. Set the OAuth redirect URI on the app to `http://localhost:8080/callback`.
3. Copy `.env.example` to `.env` and fill in `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET`.
4. `npm install`
5. `npm run get-token` — opens browser, you authorize, the script prints `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_REFRESH_TOKEN`, `LINKEDIN_USER_URN` for copy into GitHub Secrets.
6. Add all five values to **Settings → Secrets → Actions** in this repo.

## Day-to-day

Write a post:

```bash
echo '---
visibility: PUBLIC
status: ready
---

Your hook here.

The rest of the post.' > posts/2026-05-25.md
```

Test it:

```bash
npm run post:dry              # uses today's date
npm run post -- --date 2026-05-25 --dry-run
```

Commit. The Action handles the rest at 14:00 UTC.

## Why this exists

Most marketing teams hire to scale: more people, more agencies, more tools. The opposite approach is to architect systems that automate the work, then let small teams (or one person) operate at the output of much larger ones. This is one of those systems, written in public.

The complete method is documented at [codex-os.vercel.app](https://codex-os.vercel.app).

## Intel sweep (weekly)

A second module: every Monday at 09:00 UTC, a GitHub Action scrapes a list of competitor + research URLs via [Firecrawl](https://www.firecrawl.dev/) and commits a dated report to `intel/output/`. Material for the newsletter, for posts, for competitive positioning.

```
intel/targets.json  →  GitHub Action @ Mon 09:00 UTC  →  Firecrawl /v2/scrape  →  intel/output/YYYY-MM-DD.md
```

**Setup:**

1. Grab a Firecrawl API key at https://www.firecrawl.dev/ (free tier: 500 credits/mo).
2. Add `FIRECRAWL_API_KEY` to GitHub Secrets (and to `.env` for local runs).
3. Edit `intel/targets.json` — add/remove URLs, group them by `tag`.

**Run locally:**

```bash
npm run intel:dry     # scrape but don't write — preview first 500 chars per target
npm run intel         # write intel/output/YYYY-MM-DD.md
```

The weekly workflow commits the output back to the repo (build-in-public). If you'd rather keep reports private, flip `permissions: contents: write` → `read` in `intel-weekly.yml` and upload as an artifact instead.

## Files

```
codex-engine/
├── posts/                    # your LinkedIn queue (markdown files, one per date)
├── intel/
│   ├── targets.json          # what to scrape — edit this
│   └── output/               # weekly reports land here
├── scripts/
│   ├── get-token.ts          # one-time OAuth helper
│   ├── post.ts               # publishes today's post
│   └── intel-sweep.ts        # weekly intel sweep (Firecrawl)
├── lib/
│   ├── linkedin.ts           # API client (OAuth refresh, post creation)
│   └── firecrawl.ts          # API client (scrape)
└── .github/workflows/
    ├── post-daily.yml        # cron @ 14:00 UTC daily
    └── intel-weekly.yml      # cron @ 09:00 UTC Mondays
```

## License

MIT. Fork it. Adapt it. Run your own.
