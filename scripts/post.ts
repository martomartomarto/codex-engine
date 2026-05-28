// Find today's scheduled post and publish it to LinkedIn.
//
// Called by .github/workflows/post-daily.yml on cron.
// Looks for posts/YYYY-MM-DD.md in repo root.
//
// Post format (gray-matter frontmatter):
//   ---
//   visibility: PUBLIC  # or CONNECTIONS (default: PUBLIC)
//   status: ready       # ready | sent | draft (only ready gets published)
//   ---
//   The actual post body. Plain text. Line breaks preserved.
//
// Flags:
//   --dry-run    Print what would be posted, don't actually post
//   --date YYYY-MM-DD  Override today's date (useful for testing)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { refreshAccessToken, createPost, uploadImage } from "../lib/linkedin.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    const raw = readFileSync(join(ROOT, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // env may come from shell / GH Action secrets
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    date: (() => {
      const i = args.indexOf("--date");
      if (i >= 0 && args[i + 1]) return args[i + 1];
      return new Date().toISOString().slice(0, 10);
    })(),
  };
}

function findPost(date: string) {
  const path = join(ROOT, "posts", `${date}.md`);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const parsed = matter(raw);
  return {
    path,
    data: parsed.data as {
      visibility?: "PUBLIC" | "CONNECTIONS";
      status?: string;
      image?: string;
      image_alt?: string;
    },
    body: parsed.content.trim(),
  };
}

async function loadImageBytes(spec: string, postPath: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (spec.startsWith("http://") || spec.startsWith("https://")) {
    const res = await fetch(spec);
    if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "image/png";
    const arrayBuffer = await res.arrayBuffer();
    return { bytes: new Uint8Array(arrayBuffer), contentType };
  }
  // Local path: resolved relative to the post file's directory unless absolute.
  const path = isAbsolute(spec) ? spec : resolve(dirname(postPath), spec);
  if (!existsSync(path)) {
    throw new Error(`image not found: ${path}`);
  }
  const bytes = new Uint8Array(readFileSync(path));
  const contentType = path.toLowerCase().endsWith(".jpg") || path.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : path.toLowerCase().endsWith(".gif")
    ? "image/gif"
    : "image/png";
  return { bytes, contentType };
}

function listAvailable(): string[] {
  try {
    return readdirSync(join(ROOT, "posts"))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

async function main() {
  loadEnv();
  const { dryRun, date } = parseArgs();

  const post = findPost(date);
  if (!post) {
    console.error(`✗ No post scheduled for ${date}.`);
    const available = listAvailable();
    if (available.length) {
      console.error(`  Available dates: ${available.map((f) => f.replace(".md", "")).join(", ")}`);
    }
    // Fail loudly: silent success on missing files hid a stuck PR for days (May 23–27, 2026).
    process.exit(1);
  }

  if (post.data.status && post.data.status !== "ready") {
    console.log(`Post ${date} status="${post.data.status}" — skipping (only "ready" gets published).`);
    process.exit(0);
  }

  if (!post.body) {
    console.error(`Post ${date} has empty body — skipping.`);
    process.exit(1);
  }

  console.log(`▸ Post for ${date} (${post.body.length} chars)`);
  if (post.data.image) console.log(`▸ Attached image: ${post.data.image}`);
  console.log("───────────────────────────────────────────");
  console.log(post.body);
  console.log("───────────────────────────────────────────");

  if (dryRun) {
    // Resolve the image so we catch path/URL issues at dry-run time,
    // without actually uploading anything to LinkedIn.
    if (post.data.image) {
      if (!post.data.image_alt) {
        console.error("✗ image is set but image_alt is missing — LinkedIn rejects posts without alt text.");
        process.exit(1);
      }
      try {
        const { bytes, contentType } = await loadImageBytes(post.data.image, post.path);
        console.log(`✓ Image OK — ${(bytes.length / 1024).toFixed(1)} KB · ${contentType}`);
      } catch (err) {
        console.error(`✗ Image load failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    }
    console.log("✓ Dry run — not publishing.");
    process.exit(0);
  }

  if (!process.env.LINKEDIN_USER_URN) {
    console.error("Missing env var: LINKEDIN_USER_URN");
    process.exit(1);
  }

  // Try to refresh first if we have a refresh token; otherwise use the access
  // token directly. LinkedIn Default Tier apps don't get refresh tokens, so the
  // access token (valid ~60 days) is what we have to work with.
  let accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const hasRefresh =
    process.env.LINKEDIN_REFRESH_TOKEN &&
    process.env.LINKEDIN_CLIENT_ID &&
    process.env.LINKEDIN_CLIENT_SECRET;

  if (hasRefresh) {
    console.log("⟳ Refreshing access token…");
    const tokens = await refreshAccessToken({
      clientId: process.env.LINKEDIN_CLIENT_ID!,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET!,
      refreshToken: process.env.LINKEDIN_REFRESH_TOKEN!,
    });
    accessToken = tokens.access_token;
  }

  if (!accessToken) {
    console.error("Missing LINKEDIN_ACCESS_TOKEN (and no refresh token to mint one).");
    console.error("Run `npm run get-token` to re-authorize.");
    process.exit(1);
  }

  // Upload image first if the post references one.
  let media: { imageUrn: string; altText: string } | undefined;
  if (post.data.image) {
    if (!post.data.image_alt) {
      console.error("Posts with images must include an `image_alt` field (accessibility + LinkedIn requirement).");
      process.exit(1);
    }
    console.log("↑ Uploading image to LinkedIn…");
    const { bytes, contentType } = await loadImageBytes(post.data.image, post.path);
    const uploaded = await uploadImage({
      accessToken,
      ownerUrn: process.env.LINKEDIN_USER_URN!,
      imageBytes: bytes,
      contentType,
    });
    media = { imageUrn: uploaded.urn, altText: post.data.image_alt };
    console.log(`  image urn: ${uploaded.urn}`);
  }

  console.log("→ Publishing to LinkedIn…");
  const result = await createPost({
    accessToken,
    authorUrn: process.env.LINKEDIN_USER_URN!,
    commentary: post.body,
    visibility: post.data.visibility ?? "PUBLIC",
    media,
  });

  console.log(`✓ Published. Post ID: ${result.id}`);
}

main().catch((err) => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
