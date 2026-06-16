// Every Sunday: read the fresh repo-radar + intel sweep + recent posts, have Claude
// curate 4-5 real, ready-to-pick post IDEAS in Martín's voice, and email them.
//
// This is the "ideas of the week" step. It does NOT write posts or publish —
// Martín picks one, then the post gets written and goes through the email-approval
// flow (send-draft → /api/approve → publish).
//
// Called by .github/workflows/ideas-weekly.yml on cron (Sun 13:00 UTC = 10am ARG).
//
// Env vars (all required):
//   ANTHROPIC_API_KEY   console.anthropic.com — for the curation step
//   RESEND_API_KEY      sending-only key from resend.com
//   NOTIFY_EMAIL_TO     recipient (Martín)
//   NOTIFY_EMAIL_FROM   sender (onboarding@resend.dev works without a verified domain)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    const raw = readFileSync(join(ROOT, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // env comes from GitHub Action secrets in CI
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Newest dated .md in a directory (returns its text, or "" if none).
function latestDated(dir: string): { name: string; text: string } | null {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return null;
  const files = readdirSync(full)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
  if (!files.length) return null;
  const name = files[files.length - 1];
  return { name, text: readFileSync(join(full, name), "utf8") };
}

// Recent post hooks (first body line) so Claude doesn't repeat themes.
function recentHooks(limit = 8): string[] {
  const dir = join(ROOT, "posts");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .slice(-limit);
  return files.map((f) => {
    const body = matter(readFileSync(join(dir, f), "utf8")).content.trim();
    const hook = body.split("\n").find((l) => l.trim()) ?? "";
    return `${f.replace(".md", "")}: ${hook.slice(0, 120)}`;
  });
}

const BASE_PROMPT = `You curate weekly LinkedIn post ideas for Martín, a Growth Lead who builds marketing/ops systems with AI.

His feed, in his words: first person, English, no branding, no signature, no links, no pitch. The angle is always "a Growth Lead who builds systems with AI" — not a marketing manager, and NOT an engineer. Dry, direct, no hype.

ALTITUDE — the single most important rule. Write for an operator/founder reading on their phone, NOT for a developer. Lead with the outcome or the idea, never the implementation. If something is technical, translate it into what it lets a person build and why it matters — cut the mechanism unless the mechanism IS the insight. Avoid plumbing vocabulary (race condition, OAuth, API 4xx, cron, webhook, schema, regex, rate limit, token, deploy pipeline) unless the post is literally about that bug. Litmus test for every idea: would a founder who can't code find this interesting? If only an engineer would, rewrite it or drop it.

What he wants to post about — rotate roughly evenly between the first two:
1. Lesser-known open-source repos + the OPERATOR's angle on why they matter — not the technical insight, the "what this unlocks for someone building a business" insight (from the "REPO RADAR" input below).
2. Track-record milestones — real systems he built/shipped at a LATAM PropTech SaaS, told as "here's what I built and what it changed" (from the "MILESTONE BANK" input below).
3. Things from his day-to-day building growth systems that are genuinely worth sharing.

REPO QUALITY BAR — be ruthless. The radar over-collects; most candidates are NOT worth a post. REJECT: code formatters/linters, media-server themes, dev-only tooling, niche hobby projects, anything a growth/marketing operator or founder wouldn't care about, and anything mainstream everyone already knows. KEEP only repos that genuinely help someone BUILD or MARKET something (design/front-end craft, marketing/growth/analytics tooling, AI that touches the creative or ops layer). The radar's "Post seed / Ángulo" line is AUTO-GENERATED filler — IGNORE it and form your own angle from the repo's real description and what it does. If fewer than ~2 repos clear this bar, propose fewer repo ideas and lean on milestones/day-to-day instead — never pad with weak repos.

ANONYMIZATION (hard rule): never name the company, clients, colleagues, or the product. Use proxies ("a LATAM PropTech SaaS", "a SaaS scaling across Mexico and Argentina"). Never expose ARR/MRR/revenue/customer counts/CAC/churn or anyone's name. Numbers about the SYSTEM are fine ("20+ live pages"); numbers about the BUSINESS are not.

DEDUP AGAINST THE PUBLISHED LIBRARY (hard rule). The "PUBLISHED LIBRARY" input below lists every topic he has ALREADY posted or already written. Check every idea against it. If an idea is close to anything there — same system, same lesson, same angle — DROP it. Do not propose it. At most it becomes an "update", never a new post. This applies to BOTH repos and milestones. He has noticed and disliked repeated topics — err on the side of cutting.

Also do NOT repeat themes from his recent queued posts (listed below).

For each idea give:
- A strong first-person HOOK (1 line, in his voice — the kind of opening that stops the scroll).
- A 2-3 sentence ANGLE: the insight, why it lands for operators/builders, and how he makes it his.
- The SOURCE (repo URL / "milestone bank" / signal).
- Whether it needs a visual or works text-only, and why.

Pick the 4-5 strongest, ideally a MIX of repos and milestones (not all of one kind). Lead with the best. Be concrete and opinionated — ready to write, not generic prompts. Skip weak/saturated repos. Output clean plain text (no markdown headers heavier than a number + title); this goes straight into an email.`;

// Read an optional repo file; "" if missing. Used for VOICE.md + the milestone bank.
function readOptional(relPath: string): string {
  try {
    return readFileSync(join(ROOT, relPath), "utf8").trim();
  } catch {
    return "";
  }
}

async function main() {
  loadEnv();

  for (const k of ["ANTHROPIC_API_KEY", "RESEND_API_KEY", "NOTIFY_EMAIL_TO", "NOTIFY_EMAIL_FROM"]) {
    if (!process.env[k]) {
      console.error(`Missing env: ${k}`);
      process.exit(1);
    }
  }

  const radar = latestDated("intel/radar");
  const intel = latestDated("intel/output");
  if (!radar) {
    console.error("No repo-radar report found in intel/radar/ — run the radar first.");
    process.exit(1);
  }
  const hooks = recentHooks();
  const voice = readOptional("VOICE.md");
  const milestones = readOptional("intel/track-record.md");
  const published = readOptional("intel/published.md");

  // VOICE.md is the source of truth for tone/altitude — append it as authoritative
  // when present, so the same rules govern ideas and (later) the written posts.
  const system = voice
    ? `${BASE_PROMPT}\n\n=== VOICE GUIDE (authoritative — follow this exactly) ===\n${voice}`
    : BASE_PROMPT;

  const userMsg = [
    "=== REPO RADAR (this week's rising repos — source #1) ===",
    radar.text,
    "",
    "=== MILESTONE BANK (anonymized track-record seeds — source #2) ===",
    milestones || "(none — propose only repo/day-to-day ideas this week)",
    "",
    intel ? "=== INTEL SWEEP (competitor / sector movements) ===\n" + intel.text : "(no intel sweep this week)",
    "",
    "=== PUBLISHED LIBRARY (ALREADY DONE — do NOT propose anything close to these) ===",
    published || "(none on record — still avoid obvious repeats)",
    "",
    "=== RECENT QUEUED POSTS (also do NOT repeat these themes) ===",
    hooks.length ? hooks.join("\n") : "(none)",
    "",
    "Give me this week's 4-5 post ideas — a mix of repos and milestones, NONE overlapping the published library, every repo clearing the quality bar.",
  ].join("\n");

  console.log(
    `▸ Curating ideas from radar ${radar.name}${intel ? ` + intel ${intel.name}` : ""}` +
      `${milestones ? " + milestone bank" : ""}${published ? " + published library" : ""}` +
      `${voice ? " (voice guide loaded)" : ""}…`,
  );

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const ideas = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!ideas) {
    console.error("Claude returned no text — aborting.");
    process.exit(1);
  }

  // Dry run: print the curated ideas (so they show up in the Action log) and skip
  // the email. Lets us inspect output without emailing. --dry-run or DRY_RUN=1.
  if (process.argv.includes("--dry-run") || process.env.DRY_RUN === "1") {
    console.log("\n===== IDEAS (dry-run — NOT emailed) =====\n");
    console.log(ideas);
    console.log("\n===== end ideas =====");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const escaped = escapeHtml(ideas).replace(/\n/g, "<br/>");
  const subject = `[LinkedIn] Ideas de la semana — ${today}`;
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px;">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5;">
  <div style="background:#0a0a0a;color:#e8e8e6;padding:28px 32px;">
    <div style="font-family:'SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.1em;color:#777772;text-transform:uppercase;margin-bottom:10px;">LinkedIn · ideas de la semana</div>
    <div style="font-size:22px;font-weight:600;letter-spacing:-0.015em;">Elegí de qué postear esta semana</div>
    <div style="font-family:'SF Mono',Menlo,monospace;font-size:12px;color:#b8b8b4;margin-top:10px;">radar: ${escapeHtml(radar.name.replace(".md", ""))} · ${today}</div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:15px;line-height:1.7;color:#1a1a1a;">${escaped}</div>
    <div style="margin-top:28px;color:#777;font-size:13px;line-height:1.7;border-top:1px solid #eee;padding-top:20px;">
      Para elegir, decímelo por Claude (ej. "dale a la 1 y la 3") y la escribo + te mando el draft para aprobar. <em>(Responder este mail no dispara nada todavía.)</em>
    </div>
  </div>
</div>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_EMAIL_FROM,
      to: process.env.NOTIFY_EMAIL_TO,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    console.error(`Resend failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const data = (await res.json()) as { id?: string };
  console.log(`✓ Weekly ideas email sent — Resend id: ${data.id ?? "(unknown)"}`);
}

main().catch((err) => {
  console.error("✗ weekly-ideas failed:", err);
  process.exit(1);
});
