// Sends the day's draft post to Martín by email for approval BEFORE anything is
// published. The email carries a signed "Aprobar y publicar" button + the full
// post preview. Nothing reaches LinkedIn until that button (and the confirm page
// behind it) is clicked.
//
// To iterate: just reply to the email with your changes — Martín edits the post
// file and re-runs this script (or re-triggers the workflow) to get a fresh draft.
//
// Called by .github/workflows/draft-notify.yml on cron (or workflow_dispatch).
//
// Env vars (all required):
//   RESEND_API_KEY      sending-only key from resend.com
//   NOTIFY_EMAIL_TO     recipient (Martín)
//   NOTIFY_EMAIL_FROM   sender (onboarding@resend.dev works without a verified domain,
//                               but free Resend can only send to the account owner)
//   APPROVE_SECRET      HMAC secret — MUST match the one set on Vercel
//   APPROVE_BASE_URL    Vercel deployment base, e.g. https://codex-engine.vercel.app
//
// Flags:
//   --date YYYY-MM-DD   Override today's date (default: today, UTC)

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { sign } from "../lib/sign.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    const raw = readFileSync(resolve(ROOT, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // env may come from shell / GH Action secrets
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseDate(): string {
  const args = process.argv.slice(2);
  const i = args.indexOf("--date");
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  loadEnv();

  const required = [
    "RESEND_API_KEY",
    "NOTIFY_EMAIL_TO",
    "NOTIFY_EMAIL_FROM",
    "APPROVE_SECRET",
    "APPROVE_BASE_URL",
  ];
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`Missing env: ${k}`);
      process.exit(1);
    }
  }

  const date = parseDate();
  const filePath = resolve(ROOT, "posts", `${date}.md`);
  if (!existsSync(filePath)) {
    console.log(`No post file at posts/${date}.md — nothing to send.`);
    const available = readdirSync(resolve(ROOT, "posts"))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.replace(".md", ""));
    if (available.length) console.log(`Available: ${available.join(", ")}`);
    // Not an error — a day with no post is fine now that publishing is manual.
    process.exit(0);
  }

  const parsed = matter(readFileSync(filePath, "utf8"));
  const meta = parsed.data as {
    visibility?: string;
    status?: string;
    image?: string;
    image_alt?: string;
  };
  const body = parsed.content.trim();

  if (meta.status && meta.status === "sent") {
    console.log(`Post ${date} is already status:sent — skipping draft email.`);
    process.exit(0);
  }
  if (!body) {
    console.error(`Post ${date} has empty body — skipping.`);
    process.exit(1);
  }

  const visibility = (meta.visibility ?? "PUBLIC").toUpperCase();

  // Signed approve link → Vercel confirm page.
  const sig = sign(date, process.env.APPROVE_SECRET!);
  const base = process.env.APPROVE_BASE_URL!.replace(/\/$/, "");
  const approveUrl = `${base}/api/approve?date=${encodeURIComponent(date)}&sig=${sig}`;

  // Optional image attachment (so you see exactly what ships).
  const attachments: Array<{ filename: string; content: string }> = [];
  if (meta.image && !meta.image.startsWith("http")) {
    const imgPath = isAbsolute(meta.image) ? meta.image : resolve(dirname(filePath), meta.image);
    if (existsSync(imgPath)) {
      attachments.push({
        filename: basename(imgPath),
        content: readFileSync(imgPath).toString("base64"),
      });
    }
  }

  const escapedBody = escapeHtml(body).replace(/\n/g, "<br/>");
  const subject = `[LinkedIn] Aprobar post del ${date}`;
  const imageNote = meta.image
    ? `<div style="margin-top:16px;padding:14px 16px;background:#f5f5f5;border-radius:4px;color:#555;font-size:13px;font-family:monospace;">📎 imagen: ${escapeHtml(meta.image)}${attachments.length ? " (adjunta abajo)" : " (URL remota)"}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5;">
  <div style="background:#0a0a0a;color:#e8e8e6;padding:28px 32px;">
    <div style="font-family:'SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.1em;color:#777772;text-transform:uppercase;margin-bottom:10px;">LinkedIn · revisión de post</div>
    <div style="font-size:22px;font-weight:600;letter-spacing:-0.015em;line-height:1.3;">Post listo para ${date}</div>
    <div style="font-family:'SF Mono',Menlo,monospace;font-size:12px;color:#b8b8b4;margin-top:10px;">
      visibilidad: ${visibility} &nbsp; · &nbsp; ${body.length} caracteres
    </div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:15px;line-height:1.65;color:#1a1a1a;background:#fafafa;padding:22px 24px;border-radius:6px;border:1px solid #eee;">${escapedBody}</div>
    ${imageNote}
    <div style="margin-top:32px;text-align:center;">
      <a href="${approveUrl}" style="background:#0a0a0a;color:#fff;padding:16px 36px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block;font-size:15px;letter-spacing:-0.005em;">Aprobar y publicar →</a>
    </div>
    <div style="margin-top:24px;color:#777;font-size:13px;text-align:center;line-height:1.7;">
      <strong>Aprobar</strong> = abre una página de confirmación; ahí publicás.<br/>
      <strong>¿Cambios?</strong> Decímelo por Claude y lo edito + reenvío.<br/>
      Si no hacés nada, <strong>no se publica</strong>.
    </div>
  </div>
</div>
</body></html>`;

  const payload: Record<string, unknown> = {
    from: process.env.NOTIFY_EMAIL_FROM,
    to: process.env.NOTIFY_EMAIL_TO,
    subject,
    html,
  };
  if (attachments.length) payload.attachments = attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`Resend failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const data = (await res.json()) as { id?: string };
  console.log(`✓ Draft email sent for ${date} — Resend id: ${data.id ?? "(unknown)"}`);
}

main().catch((err) => {
  console.error("✗ send-draft failed:", err);
  process.exit(1);
});
