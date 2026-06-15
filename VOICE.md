# Voice — Martín's LinkedIn

Single source of truth for HOW posts sound. Read this both when curating weekly
ideas (`scripts/weekly-ideas.ts`) and when writing the actual post from a picked
idea. If a draft sounds like an engineer's changelog, it's wrong.

## Who's talking

A Growth Lead who builds marketing/ops systems with AI. Not a marketing manager,
not an engineer. The recurring move: *architect a system so a small team (or one
person) operates at the output of a much larger one.* That's the throughline.

## How it sounds

- First person. English. Dry, direct, no hype, no emojis-as-punctuation.
- **No branding, no signature, no sign-off, no links/URLs.** Just the post.
- Lead with the **outcome or the idea**, never the implementation.
- Short lines. One thought per line. A strong first line that stops the scroll.

## The altitude rule (this is what fixes "too technical")

Write for an operator/founder reading on their phone — not for a developer.

- Say **what a tool lets you do and why it matters**, not how it's wired.
- If a repo/insight is technical, **translate it to the value**: what does it
  unlock for someone building a business? Cut the mechanism unless the mechanism
  *is* the insight.
- **Banned vocabulary** (unless the post is literally about the bug): "race
  condition", "concurrency guard", "OAuth refresh", "API 400/429", "rebase",
  "cron", "webhook", "schema", "regex", "rate limit", "token", "deploy pipeline".
  These are plumbing. Nobody scrolls for plumbing.
- Litmus test: would a founder who can't code find this interesting? If only an
  engineer would, rewrite it or drop it.

### Before / after

- ❌ "Fixed a race condition by adding a concurrency guard to the revenue cron."
- ✅ "A dashboard that lies is worse than no dashboard. Spent a morning making
  sure ours fails loudly instead of showing yesterday's numbers as today's."

## Anonymization (hard rule — decided 2026-06-15)

When a post draws on day-job / track-record material:

- **Never name the company, clients, colleagues, or the product.** Use proxies:
  "a LATAM PropTech SaaS", "a SaaS scaling across Mexico and Argentina".
- **Never expose** ARR/MRR, revenue, customer counts, CAC, churn, deal sizes, or
  anyone's name. Numbers about the *system* are fine (e.g. "20+ live pages",
  "one weekly pipeline"), numbers about the *business* are not.
- The post is about the **system and the lesson**, not PR for the company.

## Topic mix

1. **Lesser-known open-source repos** — the operator's angle on why it's worth knowing (from REPO RADAR).
2. **Track-record milestones** — real systems built/shipped at a LATAM PropTech SaaS, anonymized, as "here's what I built and what it changed" (from MILESTONE BANK).
3. **Day-to-day** building growth systems that's genuinely worth sharing.

Aim for a roughly even rotation between repos and milestones — don't let the feed
become all-tools or all-war-stories.
