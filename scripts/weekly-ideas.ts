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

const SYSTEM_PROMPT = `You curate weekly LinkedIn post ideas for Martín, a Growth Lead who builds marketing/ops systems with AI.

His feed, in his words: first person, English, no branding, no signature, no pitch. The angle is always "a Growth Lead who builds systems with AI" — not a marketing manager. Dry, direct, no hype.

What he wants to post about, in priority order:
1. Lesser-known open-source git repos + sharp technical insights (this is the core — it comes from the "REPO RADAR" input below).
2. Things from his day-to-day building growth systems that are genuinely worth sharing.
3. Anything from his work at a LATAM PropTech SaaS ("Lebane") ONLY if there's something new and concrete — and always anonymized: never name the company, clients, colleagues, or expose ARR/MRR/churn/customer counts. Use proxies ("a LATAM SaaS", "scaling across LATAM").

Do NOT repeat themes from his recent posts (listed below).

For each idea give:
- A strong first-person HOOK (1 line, in his voice — the kind of opening that stops the scroll).
- A 2-3 sentence ANGLE: the insight, why it lands for operators/builders, and how he can make it his (tie to his real experience when relevant).
- The SOURCE (repo URL / signal) when it comes from the radar.
- Whether it needs a visual or works text-only, and why.

Pick the 4-5 strongest. Lead with the best. Be concrete and opinionated — these should feel ready to write, not generic prompts. Skip weak/saturated repos. Output clean plain text (no markdown headers heavier than a number + title); this goes straight into an email.`;

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

  const userMsg = [
    "=== REPO RADAR (this week's rising repos — the main source) ===",
    radar.text,
    "",
    intel ? "=== INTEL SWEEP (competitor / sector movements) ===\n" + intel.text : "(no intel sweep this week)",
    "",
    "=== RECENT POSTS (do NOT repeat these themes) ===",
    hooks.length ? hooks.join("\n") : "(none)",
    "",
    "Give me this week's 4-5 post ideas.",
  ].join("\n");

  console.log(`▸ Curating ideas from radar ${radar.name}${intel ? ` + intel ${intel.name}` : ""}…`);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: SYSTEM_PROMPT,
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
      Respondé este mail con la que querés (ej. "dale a la 1 y la 3") y la escribo + te mando el draft para aprobar.
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
