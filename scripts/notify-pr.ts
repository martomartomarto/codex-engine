// Sends a Resend email to Martín whenever a PR is opened that touches posts/*.md.
//
// Triggered by .github/workflows/pr-notify.yml.
// Why this exists: GitHub doesn't notify you about your own PRs in your own repo,
// so we route notifications via Resend instead.
//
// Env vars (all required):
//   RESEND_API_KEY        sending-only key from resend.com
//   NOTIFY_EMAIL_TO       recipient
//   NOTIFY_EMAIL_FROM     sender (onboarding@resend.dev works without domain verification,
//                                  but on free Resend can only send to the account owner email)
//   GH_TOKEN              GitHub Actions auto-injects GITHUB_TOKEN; we pass it through
//   PR_NUMBER, PR_TITLE, PR_URL, REPO   pulled from github.event.pull_request

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface PRFile {
  filename: string;
  status: string;
}

async function listPRFiles(repo: string, prNumber: string, token: string): Promise<PRFile[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/files`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub PR files API failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PRFile[];
}

async function main() {
  const required = [
    "RESEND_API_KEY",
    "NOTIFY_EMAIL_TO",
    "NOTIFY_EMAIL_FROM",
    "GH_TOKEN",
    "PR_NUMBER",
    "PR_TITLE",
    "PR_URL",
    "REPO",
  ];
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`Missing env: ${k}`);
      process.exit(1);
    }
  }

  const files = await listPRFiles(
    process.env.REPO!,
    process.env.PR_NUMBER!,
    process.env.GH_TOKEN!,
  );
  const postFile = files.find((f) => /^posts\/\d{4}-\d{2}-\d{2}\.md$/.test(f.filename));

  if (!postFile) {
    console.log("No post file in PR — skipping notification.");
    process.exit(0);
  }

  const filePath = resolve(ROOT, postFile.filename);
  if (!existsSync(filePath)) {
    console.error(`Post file not found at: ${filePath}`);
    process.exit(1);
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const meta = parsed.data as {
    visibility?: string;
    status?: string;
    image?: string;
    image_alt?: string;
  };
  const body = parsed.content.trim();
  const date = postFile.filename.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "?";
  const visibility = (meta.visibility ?? "PUBLIC").toUpperCase();
  const status = meta.status ?? "ready";

  // Image attachment
  const attachments: Array<{ filename: string; content: string }> = [];
  if (meta.image && !meta.image.startsWith("http")) {
    const imgPath = isAbsolute(meta.image) ? meta.image : resolve(dirname(filePath), meta.image);
    if (existsSync(imgPath)) {
      const bytes = readFileSync(imgPath);
      attachments.push({
        filename: basename(imgPath),
        content: bytes.toString("base64"),
      });
    }
  }

  // HTML email
  const escapedBody = escapeHtml(body).replace(/\n/g, "<br/>");
  const subject = `[codex-engine] Post for ${date} — PR #${process.env.PR_NUMBER}`;
  const imageNote = meta.image
    ? `<div style="margin-top:16px;padding:14px 16px;background:#f5f5f5;border-radius:4px;color:#555;font-size:13px;font-family:monospace;">📎 image: ${escapeHtml(meta.image)}${attachments.length ? " (attached below)" : " (remote URL)"}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5;">
  <div style="background:#0a0a0a;color:#e8e8e6;padding:28px 32px;">
    <div style="font-family:'SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.1em;color:#777772;text-transform:uppercase;margin-bottom:10px;">codex-engine · post review</div>
    <div style="font-size:22px;font-weight:600;letter-spacing:-0.015em;line-height:1.3;">${escapeHtml(process.env.PR_TITLE!)}</div>
    <div style="font-family:'SF Mono',Menlo,monospace;font-size:12px;color:#b8b8b4;margin-top:10px;">
      scheduled: ${date} · 14:00 UTC &nbsp; · &nbsp; visibility: ${visibility} &nbsp; · &nbsp; status: ${status}
    </div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:15px;line-height:1.65;color:#1a1a1a;white-space:normal;background:#fafafa;padding:22px 24px;border-radius:6px;border:1px solid #eee;">${escapedBody}</div>
    ${imageNote}
    <div style="margin-top:32px;text-align:center;">
      <a href="${process.env.PR_URL}" style="background:#0a0a0a;color:#fff;padding:14px 32px;text-decoration:none;border-radius:4px;font-weight:600;display:inline-block;font-size:14px;letter-spacing:-0.005em;">Review on GitHub →</a>
    </div>
    <div style="margin-top:24px;color:#777;font-size:13px;text-align:center;line-height:1.7;">
      <strong>Approve</strong> = merge the PR → publishes at 14:00 UTC<br/>
      <strong>Reject</strong> = close the PR → never publishes
    </div>
  </div>
</div>
</body></html>`;

  // Send
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
  console.log(`✓ Email sent — Resend id: ${data.id ?? "(unknown)"}`);
}

main().catch((err) => {
  console.error("✗ notify-pr failed:", err);
  process.exit(1);
});
