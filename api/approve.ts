// GET /api/approve?date=YYYY-MM-DD&sig=...
//
// Step 1 of approval. Verifies the signed link from the draft email, fetches the
// post straight from GitHub `main` (so it always reflects the latest edit), and
// renders a confirmation page with a preview + a "Publicar ahora" button that
// POSTs to /api/publish.
//
// Why a confirm page instead of publishing on the link click directly: email
// clients and security scanners pre-fetch links (GET), which would publish by
// accident. A second, explicit POST avoids that.
//
// Env vars: APPROVE_SECRET (must match the GitHub Action), REPO (owner/name).

import matter from "gray-matter";
import { verify } from "../lib/sign.ts";

const REPO = process.env.REPO || "martomartomarto/codex-engine";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, inner: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${esc(title)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5;">${inner}</div>
</body></html>`;
}

export default async function handler(req: any, res: any) {
  const secret = process.env.APPROVE_SECRET;
  if (!secret) {
    res.status(500).send(page("Error", `<div style="padding:32px;">APPROVE_SECRET no está configurado en Vercel.</div>`));
    return;
  }

  const date = String(req.query.date || "");
  const sig = String(req.query.sig || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !verify(date, sig, secret)) {
    res.status(403).send(page("Link inválido", `<div style="padding:32px;color:#b00;">Link inválido o vencido.</div>`));
    return;
  }

  // Pull the post from GitHub main — always the latest version.
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/main/posts/${date}.md`;
  const r = await fetch(rawUrl);
  if (!r.ok) {
    res.status(404).send(page("No encontrado", `<div style="padding:32px;">No hay post para ${esc(date)} en main.</div>`));
    return;
  }
  const parsed = matter(await r.text());
  const meta = parsed.data as { visibility?: string; status?: string; image?: string };
  const body = parsed.content.trim();

  if (meta.status === "sent") {
    res.status(200).send(page("Ya publicado", `
      <div style="background:#0a0a0a;color:#e8e8e6;padding:28px 32px;font-size:20px;font-weight:600;">✓ Ya publicado</div>
      <div style="padding:32px;color:#444;">El post del ${esc(date)} ya está marcado como <code>sent</code>. No se vuelve a publicar.</div>`));
    return;
  }

  const visibility = (meta.visibility ?? "PUBLIC").toUpperCase();
  const escapedBody = esc(body).replace(/\n/g, "<br/>");
  const imgNote = meta.image
    ? `<div style="margin-top:16px;padding:14px 16px;background:#f5f5f5;border-radius:4px;color:#555;font-size:13px;font-family:monospace;">📎 imagen: ${esc(meta.image)}</div>`
    : "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(page(`Aprobar post ${date}`, `
  <div style="background:#0a0a0a;color:#e8e8e6;padding:28px 32px;">
    <div style="font-family:'SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.1em;color:#777772;text-transform:uppercase;margin-bottom:10px;">codex-engine · confirmar publicación</div>
    <div style="font-size:22px;font-weight:600;line-height:1.3;">Post del ${esc(date)}</div>
    <div style="font-family:'SF Mono',Menlo,monospace;font-size:12px;color:#b8b8b4;margin-top:10px;">visibilidad: ${esc(visibility)} · ${body.length} caracteres</div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:15px;line-height:1.65;color:#1a1a1a;background:#fafafa;padding:22px 24px;border-radius:6px;border:1px solid #eee;">${escapedBody}</div>
    ${imgNote}
    <form method="POST" action="/api/publish" style="margin-top:32px;text-align:center;">
      <input type="hidden" name="date" value="${esc(date)}"/>
      <input type="hidden" name="sig" value="${esc(sig)}"/>
      <button type="submit" style="background:#0a0a0a;color:#fff;padding:16px 40px;border:none;border-radius:6px;font-weight:600;font-size:15px;cursor:pointer;">Publicar ahora en LinkedIn</button>
    </form>
    <div style="margin-top:20px;color:#999;font-size:13px;text-align:center;">Esto publica de verdad. Si querés cambios, cerrá esto y respondé el mail.</div>
  </div>`));
}
