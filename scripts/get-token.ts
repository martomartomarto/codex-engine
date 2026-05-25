// One-time OAuth helper.
//
// What it does:
//   1. Spins up a tiny localhost server on :8080
//   2. Opens browser to LinkedIn authorization page
//   3. User clicks "Authorize" → LinkedIn redirects back to localhost with a code
//   4. Script exchanges code for access + refresh tokens
//   5. Fetches user URN
//   6. Prints values to copy into GitHub Secrets (and .env locally)
//
// Run with: npm run get-token
// Requires LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET in .env

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { readFileSync } from "node:fs";
import { exchangeCodeForTokens, fetchUserUrn } from "../lib/linkedin.ts";

const REDIRECT_URI = "http://localhost:8080/callback";
const SCOPES = ["openid", "profile", "email", "w_member_social"];
const PORT = 8080;

function loadEnv() {
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // .env optional; vars may be in shell env
  }
}

function openBrowser(url: string) {
  const opener =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  exec(`${opener} "${url}"`);
}

async function main() {
  loadEnv();
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Missing LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET in .env");
    process.exit(1);
  }

  const state = Math.random().toString(36).slice(2);
  const authUrl =
    "https://www.linkedin.com/oauth/v2/authorization?" +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      state,
      scope: SCOPES.join(" "),
    }).toString();

  console.log("\n  codex-engine · LinkedIn OAuth helper");
  console.log("  ──────────────────────────────────────");
  console.log("  Opening browser to authorize…");
  console.log(`  If it doesn't open, visit:\n  ${authUrl}\n`);

  const server = createServer(async (req, res) => {
    if (!req.url?.startsWith("/callback")) {
      res.writeHead(404);
      res.end();
      return;
    }

    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h1>Error: ${error}</h1><p>${url.searchParams.get("error_description") ?? ""}</p>`);
      console.error(`\n  ✗ LinkedIn returned error: ${error}`);
      server.close();
      process.exit(1);
    }

    if (!code || returnedState !== state) {
      res.writeHead(400);
      res.end("Invalid state or missing code");
      server.close();
      process.exit(1);
    }

    try {
      const tokens = await exchangeCodeForTokens({
        clientId,
        clientSecret,
        code,
        redirectUri: REDIRECT_URI,
      });
      const userUrn = await fetchUserUrn(tokens.access_token);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body style='font-family:sans-serif;background:#0a0a0a;color:#e8e8e6;padding:40px'>" +
        "<h1 style='font-weight:600;letter-spacing:-0.02em'>Authorized.</h1>" +
        "<p>You can close this tab. Tokens are in your terminal.</p>" +
        "</body></html>"
      );

      console.log("\n  ✓ Authorization successful\n");
      console.log("  Copy these into GitHub Secrets (Settings → Secrets → Actions):\n");
      console.log(`  LINKEDIN_ACCESS_TOKEN=${tokens.access_token}`);
      console.log(`  LINKEDIN_REFRESH_TOKEN=${tokens.refresh_token ?? "(not provided)"}`);
      console.log(`  LINKEDIN_USER_URN=${userUrn}`);
      console.log(`  LINKEDIN_CLIENT_ID=${clientId}`);
      console.log(`  LINKEDIN_CLIENT_SECRET=${clientSecret}\n`);
      console.log(`  Access token expires in: ${tokens.expires_in}s (~${Math.round(tokens.expires_in / 86400)} days)`);
      if (tokens.refresh_token_expires_in) {
        console.log(`  Refresh token expires in: ${tokens.refresh_token_expires_in}s (~${Math.round(tokens.refresh_token_expires_in / 86400)} days)`);
      }
      console.log("");

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500);
      res.end("Token exchange failed");
      console.error("\n  ✗ Token exchange failed:", err);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    openBrowser(authUrl);
  });
}

main();
