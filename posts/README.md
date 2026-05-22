# posts/

One file per post: `YYYY-MM-DD.md`. The GitHub Action looks for `posts/{today-UTC}.md` at 14:00 UTC and publishes it.

## Format

```markdown
---
visibility: PUBLIC          # PUBLIC | CONNECTIONS (default: PUBLIC)
status: ready               # ready | draft | sent (only "ready" publishes)
---

The first line is your hook. Make it strong.

Then the body. LinkedIn doesn't support markdown — line breaks are
preserved but bold/italic/lists are rendered as plain text. Keep
it scannable: short paragraphs, one idea per line.

Hashtags go at the bottom.

— signature line (optional)

#growth #ai #operators
```

## Status field

- `ready` → publishes on the scheduled date.
- `draft` → skipped, still in repo for future editing.
- `sent` → manually marked after publish (not enforced; useful for audit).

## Manual run

From Actions tab in GitHub: **Run workflow** → optionally override date or set dry_run.

Locally:
```bash
npm run post:dry              # print today's post without publishing
npm run post -- --date 2026-05-25 --dry-run
npm run post                  # publish today
```
