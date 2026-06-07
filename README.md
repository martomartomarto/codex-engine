# codex-engine

The system that posts to LinkedIn for me.

Part of [Codex](https://codex-os.vercel.app) — an AI operating system for growth teams. This repo is the operator's LinkedIn publishing module: posts live as markdown in `posts/`. **Nothing is published automatically.** Each post is emailed for approval first; you publish with one click.

```
posts/2026-06-08.md
   │
   ▼  Mon/Fri 13:00 UTC — GitHub Action sends a DRAFT EMAIL (does NOT publish)
   │     · full preview + signed "Aprobar y publicar" button
   │     · to iterate: reply to the email with changes
   ▼  you click → Vercel /api/approve (confirm page) → /api/publish
   │
   ▼  fires publish.yml → scripts/post.ts → LinkedIn /rest/posts → feed
         (then marks the post status:sent so it can't double-post)
```

## How it works

- **Source of truth:** `posts/YYYY-MM-DD.md` files. One per post. Frontmatter controls visibility and status (`ready` → publishable, `sent` → already posted).
- **Draft notifier:** `.github/workflows/draft-notify.yml` runs Mon/Fri 13:00 UTC and runs `scripts/send-draft.ts`, which emails you the draft with a signed approve link (HMAC of the date). **This job never publishes.**
- **Approval (Vercel):** `api/approve.ts` renders a confirm page; `api/publish.ts` verifies the signature and triggers the publish workflow. The LinkedIn tokens never touch Vercel — it only holds the signing secret + a GitHub PAT.
- **Publishing:** `.github/workflows/publish.yml` (workflow_dispatch only — no cron) runs `scripts/post.ts`, which refreshes the LinkedIn token, calls the Posts API, and commits `status:sent` back to `main`.
- **Tokens:** stored as GitHub Secrets. Refresh token ~1-year lifespan; access token minted fresh per run.

### Secrets

| Secret | GitHub | Vercel | Purpose |
|---|---|---|---|
| `LINKEDIN_*` (5) | ✅ | — | publish to LinkedIn |
| `RESEND_API_KEY`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` | ✅ | — | send the draft email |
| `APPROVE_SECRET` | ✅ | ✅ | sign / verify the approve link (must match) |
| `APPROVE_BASE_URL` | ✅ | — | Vercel base URL put into the email button |
| `GH_DISPATCH_TOKEN` | — | ✅ | lets Vercel trigger the publish workflow |
| `REPO` | — | ✅ (optional) | `owner/name`, defaults to this repo |

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

Commit it to `main`. Then either wait for the Mon/Fri draft email, or send one now:

```bash
npm run send-draft -- --date 2026-05-25   # emails the draft + approve button
```

Open the email → **Aprobar y publicar** → confirm page → **Publicar ahora**. To change something, just reply to the email; edit the post, re-run `send-draft`. Nothing publishes until you click.

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
├── api/                      # Vercel serverless endpoints (approval flow)
│   ├── approve.ts            # confirm page (GET, signed link from email)
│   └── publish.ts            # verifies + triggers publish.yml (POST)
├── scripts/
│   ├── get-token.ts          # one-time OAuth helper
│   ├── post.ts               # publishes a post, marks it sent
│   ├── send-draft.ts         # emails the draft + signed approve button
│   └── intel-sweep.ts        # weekly intel sweep (Firecrawl)
├── lib/
│   ├── linkedin.ts           # API client (OAuth refresh, post creation)
│   ├── sign.ts               # HMAC signer for the approve link
│   └── firecrawl.ts          # API client (scrape)
└── .github/workflows/
    ├── draft-notify.yml      # cron Mon/Fri 13:00 UTC — emails draft (no publish)
    ├── publish.yml           # on-approval only (workflow_dispatch) — publishes
    └── intel-weekly.yml      # cron @ 09:00 UTC Mondays
```

## License

MIT. Fork it. Adapt it. Run your own.
