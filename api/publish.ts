// POST /api/publish   (body: date, sig — sent by the confirm form in /api/approve)
//
// Step 2 of approval. Re-verifies the signature, then triggers the GitHub Action
// `publish.yml` via workflow_dispatch. That Action runs scripts/post.ts, which is
// the ONE place that actually talks to LinkedIn — so the LinkedIn tokens never
// have to leave GitHub Secrets.
//
// Env vars:
//   APPROVE_SECRET     must match the GitHub Action / approve endpoint
//   GH_DISPATCH_TOKEN  GitHub PAT (fine-grained) with Actions: read+write on the repo
//   REPO               owner/name (default martomartomarto/codex-engine)

// .js extension (not .ts) — see note in api/approve.ts.
import { verify } from "../lib/sign.js";

const REPO = process.env.REPO || "martomartomarto/codex-engine";
const WORKFLOW = "publish.yml";

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:32px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e5e5;overflow:hidden;">${body}</div>
</body></html>`;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).send(page("Método no permitido", `<div style="padding:32px;">Usá el botón del mail.</div>`));
    return;
  }

  const secret = process.env.APPROVE_SECRET;
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!secret || !token) {
    res.status(500).send(page("Error", `<div style="padding:32px;">Faltan APPROVE_SECRET o GH_DISPATCH_TOKEN en Vercel.</div>`));
    return;
  }

  // @vercel/node parses urlencoded form bodies into req.body.
  const date = String(req.body?.date || "");
  const sig = String(req.body?.sig || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !verify(date, sig, secret)) {
    res.status(403).send(page("Inválido", `<div style="padding:32px;color:#b00;">Link inválido o vencido.</div>`));
    return;
  }

  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "codex-engine-approve",
      },
      body: JSON.stringify({ ref: "main", inputs: { date } }),
    }
  );

  if (r.status !== 204) {
    const detail = await r.text();
    res.status(502).send(page("Falló el disparo", `
      <div style="background:#0a0a0a;color:#e8e8e6;padding:24px 32px;font-size:18px;font-weight:600;">✗ No se pudo disparar</div>
      <div style="padding:32px;color:#444;">GitHub respondió ${r.status}.<br/><pre style="white-space:pre-wrap;font-size:12px;color:#777;">${detail.replace(/</g, "&lt;")}</pre></div>`));
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(page("Publicando", `
    <div style="background:#0a0a0a;color:#e8e8e6;padding:28px 32px;font-size:20px;font-weight:600;">🚀 En camino</div>
    <div style="padding:32px;color:#333;line-height:1.6;">
      El post del <strong>${date}</strong> se está publicando en LinkedIn (tarda ~1 minuto).<br/><br/>
      <a href="https://github.com/${REPO}/actions" style="color:#0a0a0a;">Ver el run en GitHub Actions →</a>
    </div>`));
}
