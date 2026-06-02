// Repo radar — surfaces lesser-known-but-rising open-source repos by crossing
// two signals: Hacker News (Algolia API) + GitHub Trending (via Firecrawl),
// enriched with the GitHub REST API. Writes a ranked candidate report to
// intel/radar/<date>.md that feeds LinkedIn post generation.
//
// The goal is NOT the repos everyone already names (Firecrawl, LangChain, etc.)
// — it's the ones rising in builder circles but not yet saturated. So we boost
// cross-source repos, prefer lower star counts, and penalize mainstream names.
//
// Flags:
//   --dry-run         Print the ranked table, don't write the report file
//   --date YYYY-MM-DD Override today's date
//   --top N           How many candidates to keep (default 25)
//
// Env: FIRECRAWL_API_KEY (required). GITHUB_TOKEN (optional, raises GH API limit).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scrape } from "../lib/firecrawl.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Repos so well-known that surfacing them adds nothing to a "few talk about this"
// feed. Matched case-insensitively against owner/repo and repo name.
const MAINSTREAM = new Set([
  "facebook/react", "vercel/next.js", "langchain-ai/langchain", "ollama/ollama",
  "openai/whisper", "huggingface/transformers", "pytorch/pytorch", "tensorflow/tensorflow",
  "microsoft/vscode", "torvalds/linux", "nodejs/node", "denoland/deno", "rust-lang/rust",
  "kubernetes/kubernetes", "golang/go", "n8n-io/n8n", "supabase/supabase",
  "langgenius/dify", "open-webui/open-webui", "comfyanonymous/comfyui",
]);

// Interest lexicon — the feed is about AI / agents / dev-tools / automation /
// marketing-ops. Repos that match none of this (and lack a strong HN signal)
// are dropped, so general trending noise (rsync, home-assistant integrations,
// joke repos) doesn't pollute the candidates.
const LEXICON = [
  // design / front-end craft
  "design", "ui", "ux", "component", "css", "tailwind", "animation", "animate",
  "motion", "transition", "svg", "canvas", "webgl", "shader", "three", "3d",
  "gradient", "color", "palette", "typography", "font", "layout", "grid",
  "theme", "template", "ui-kit", "design-system", "designsystem", "framer",
  "gsap", "glassmorphism", "accessibility", "a11y", "responsive", "dark-mode",
  "icon", "illustration", "figma", "web-components", "astro", "svelte", "vue",
  // visual output / dataviz / brand
  "chart", "dataviz", "visualization", "d3", "graph", "brand", "branding",
  "logo", "image", "video", "gif", "editor", "portfolio", "slides",
  "presentation", "deck", "landing", "page-builder", "website", "cms",
  // marketing / growth
  "marketing", "seo", "analytics", "social", "email", "newsletter", "copy",
  "content", "ads", "funnel", "conversion", "cro", "growth", "form", "popup",
  "widget", "embed", "no-code", "nocode", "automation", "automate", "workflow",
  // ai, but only where it touches the creative/marketing layer
  "generative", "diffusion", "tts", "voice", "avatar", "creative",
];

// Path segments that are GitHub features, not repos.
const NON_REPO_OWNERS = new Set([
  "sponsors", "marketplace", "topics", "features", "about", "collections",
  "trending", "orgs", "users", "settings", "login", "join", "explore",
  "notifications", "pulls", "issues", "search", "apps", "contact", "pricing",
  "readme", "site", "blog", "security", "customer-stories", "enterprise",
]);

function loadEnv() {
  try {
    const raw = readFileSync(join(ROOT, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  return {
    dryRun: args.includes("--dry-run"),
    date: flag("--date") ?? new Date().toISOString().slice(0, 10),
    top: Number(flag("--top") ?? 25),
  };
}

// Pull owner/repo pairs out of any text containing github.com links.
function extractRepos(text) {
  const out = new Set();
  const re = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const owner = m[1];
    let repo = m[2].replace(/\.git$/, "").replace(/[).,#?]+$/, "");
    if (NON_REPO_OWNERS.has(owner.toLowerCase())) continue;
    if (!repo || repo.length < 2) continue;
    out.add(`${owner}/${repo}`);
  }
  return out;
}

// ---- Source 1: Hacker News via Algolia (front page + Show HN) -------------
async function fetchHackerNews() {
  const now = Math.floor(Date.now() / 1000);
  const queries = [
    { tag: "story", since: now - 7 * 86400, minPoints: 75, label: "front-page-7d" },
    { tag: "show_hn", since: now - 14 * 86400, minPoints: 20, label: "show-hn-14d" },
  ];
  const repos = new Map(); // owner/repo -> { points, title, hnUrl, story }
  for (const q of queries) {
    const url = `https://hn.algolia.com/api/v1/search?tags=${q.tag}&numericFilters=created_at_i>${q.since},points>${q.minPoints}&hitsPerPage=100`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HN ${res.status}`);
      const json = await res.json();
      for (const hit of json.hits ?? []) {
        const blob = `${hit.url ?? ""} ${hit.title ?? ""}`;
        for (const slug of extractRepos(blob)) {
          const prev = repos.get(slug);
          const points = hit.points ?? 0;
          if (!prev || points > prev.points) {
            repos.set(slug, {
              points,
              title: hit.title ?? "",
              hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
              story: q.label,
            });
          }
        }
      }
      console.log(`  ✓ HN ${q.label.padEnd(16)} ${repos.size} cumulative repo hits`);
    } catch (err) {
      console.log(`  ✗ HN ${q.label.padEnd(16)} ${err.message}`);
    }
  }
  return repos;
}

// ---- Source 2: GitHub Trending via Firecrawl ------------------------------
async function fetchTrending(apiKey) {
  const pages = [
    { url: "https://github.com/trending?since=weekly", lang: "all" },
    { url: "https://github.com/trending/javascript?since=weekly", lang: "javascript" },
    { url: "https://github.com/trending/typescript?since=weekly", lang: "typescript" },
    { url: "https://github.com/trending/css?since=weekly", lang: "css" },
    { url: "https://github.com/trending/vue?since=weekly", lang: "vue" },
    { url: "https://github.com/trending/svelte?since=weekly", lang: "svelte" },
    { url: "https://github.com/trending/html?since=weekly", lang: "html" },
  ];
  const repos = new Map(); // owner/repo -> { langs:Set }
  for (const p of pages) {
    try {
      const { markdown } = await scrape({ apiKey, url: p.url });
      const found = extractRepos(markdown);
      for (const slug of found) {
        if (!repos.has(slug)) repos.set(slug, { langs: new Set() });
        repos.get(slug).langs.add(p.lang);
      }
      console.log(`  ✓ trending/${p.lang.padEnd(12)} ${found.size} repos`);
    } catch (err) {
      console.log(`  ✗ trending/${p.lang.padEnd(12)} ${err.message}`);
    }
  }
  return repos;
}

// ---- Source 3: Product Hunt (design/marketing tools, not repos) -----------
// PH renders client-side, so it needs waitFor. These are products, not GitHub
// repos — they get their own report section, no GitHub enrichment.
async function fetchProductHunt(apiKey) {
  const pages = [
    { url: "https://www.producthunt.com/", topic: "today" },
    { url: "https://www.producthunt.com/topics/design-tools", topic: "design-tools" },
    { url: "https://www.producthunt.com/topics/marketing", topic: "marketing" },
    { url: "https://www.producthunt.com/topics/no-code", topic: "no-code" },
  ];
  const products = new Map(); // slug -> { name, url, topics:Set }
  const SKIP = /^(promoted|see all|view all|read more|learn more|take a tour|sponsor)/i;
  for (const p of pages) {
    try {
      const { markdown } = await scrape({ apiKey, url: p.url, waitFor: 6000 });
      const re = /\[([^\]]{2,80})\]\((https:\/\/www\.producthunt\.com\/(?:products|posts)\/[a-z0-9-]+)[^)]*\)/gi;
      let m, count = 0;
      while ((m = re.exec(markdown)) !== null) {
        const name = m[1].trim().replace(/^\d+\\?\.\s*/, ""); // strip leaderboard "1. " numbering
        const slug = m[2].split("/").pop();
        if (SKIP.test(name) || /^!\[/.test(name)) continue;
        if (!products.has(slug)) products.set(slug, { name, url: m[2], topics: new Set() });
        products.get(slug).topics.add(p.topic);
        count++;
      }
      console.log(`  ✓ PH ${p.topic.padEnd(14)} ${count} product links`);
    } catch (err) {
      console.log(`  ✗ PH ${p.topic.padEnd(14)} ${err.message}`);
    }
  }
  return products;
}

// ---- Enrichment: GitHub REST API ------------------------------------------
async function enrich(slug) {
  const headers = { "User-Agent": "repo-radar", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${slug}`, { headers });
  if (res.status === 404) return { dead: true };
  if (res.status === 403) return { rateLimited: true };
  if (!res.ok) return null;
  const j = await res.json();
  return {
    description: j.description ?? "",
    stars: j.stargazers_count ?? 0,
    topics: j.topics ?? [],
    language: j.language ?? "",
    pushedAt: j.pushed_at ?? null,
    createdAt: j.created_at ?? null,
    homepage: j.homepage ?? "",
    archived: j.archived ?? false,
  };
}

function daysAgo(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

// How many distinct interest terms the repo touches (desc + topics + lang + HN title).
function relevance(c) {
  const blob = [
    c.meta?.description, (c.meta?.topics ?? []).join(" "), c.meta?.language, c.hn?.title,
  ].filter(Boolean).join(" ").toLowerCase();
  const hits = new Set();
  for (const term of LEXICON) {
    if (new RegExp(`\\b${term}`, "i").test(blob)) hits.add(term);
  }
  return hits.size;
}

// A candidate survives if it's topically relevant, or carries a strong enough
// HN signal that we don't want to miss it even unenriched.
function isRelevant(c) {
  // Topical fit is mandatory — raw HN buzz on off-topic news doesn't earn a spot.
  return c.rel >= 2;
}

function score(c) {
  let s = 0;
  s += Math.min(6, c.rel * 1.5); // topical fit with the feed — the main driver
  if (c.hn) s += Math.min(3, c.hn.points / 150); // social proof, minor & capped
  if (c.trending) s += 2 + (c.trending.langs.size - 1); // momentum
  if (c.hn && c.trending) s += 5; // cross-source = strong signal
  if (c.meta) {
    if (daysAgo(c.meta.pushedAt) < 30) s += 1; // actively maintained
    if (daysAgo(c.meta.createdAt) < 365) s += 1; // genuinely new
    // obscurity preference — the whole point of the feed
    if (c.meta.stars < 3000) s += 3;
    else if (c.meta.stars < 15000) s += 1;
    else if (c.meta.stars > 60000) s -= 4;
    if (c.meta.archived) s -= 5;
  }
  if (MAINSTREAM.has(c.slug.toLowerCase())) s -= 10;
  return Math.round(s * 10) / 10;
}

function angleSeed(c) {
  const d = c.meta?.description || c.hn?.title || "";
  const verb = /animation|motion|transition|gsap|framer/i.test(d) ? "movimiento que hace que un sitio se sienta vivo, sin un diseñador de motion"
    : /chart|dataviz|d3|visuali/i.test(d) ? "convierte datos en algo que la gente entiende de un vistazo"
    : /color|palette|gradient|typography|font/i.test(d) ? "la decisión estética que separa lo pro de lo genérico"
    : /component|ui-kit|design-system|tailwind|css/i.test(d) ? "los bloques que te ahorran semanas de diseño"
    : /landing|page|website|template|portfolio/i.test(d) ? "lanzás una página que convierte sin tocar Figma"
    : /seo|analytics|email|funnel|conversion|cro|ads|growth/i.test(d) ? "marketing que corre solo mientras dormís"
    : /generative|diffusion|image|video|avatar|tts|voice/i.test(d) ? "creatividad generada, lista para producción"
    : "hace una sola cosa de diseño/marketing, gratis, mejor que el SaaS que la vende";
  return `Qué hace: ${d || "—"}. Ángulo: ${verb}.`;
}

function renderProductHunt(ph) {
  const lines = [];
  lines.push("---");
  lines.push("");
  lines.push("## Product Hunt — design / marketing tools");
  lines.push("");
  if (!ph || ph.size === 0) {
    lines.push("_No products captured this run._");
    lines.push("");
    return lines.join("\n");
  }
  // Surface multi-topic products first (showed up across more than one feed).
  const sorted = [...ph.values()].sort((a, b) => b.topics.size - a.topics.size);
  for (const p of sorted) {
    lines.push(`- **${p.name}** — _${[...p.topics].join(", ")}_ · ${p.url}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderReport(date, ranked, ph) {
  const lines = [];
  lines.push(`# Repo Radar — ${date}`);
  lines.push("");
  lines.push("Lesser-known-but-rising repos for the LinkedIn feed. Crossed signals:");
  lines.push("Hacker News (last 7-14d) + GitHub Trending (weekly), enriched via GitHub API.");
  lines.push("Higher score = stronger rising signal + lower saturation. Pick from the top.");
  lines.push("");
  lines.push(`**Candidates:** ${ranked.length}  ·  **Generated:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| # | Repo | Stars | Signal | Score |");
  lines.push("|---|------|-------|--------|-------|");
  ranked.forEach((c, i) => {
    const sig = [
      c.hn ? `HN ${c.hn.points}↑` : null,
      c.trending ? `trending(${[...c.trending.langs].join(",")})` : null,
    ].filter(Boolean).join(" · ");
    const stars = c.meta ? `${(c.meta.stars / 1000).toFixed(1)}k` : "?";
    lines.push(`| ${i + 1} | ${c.slug} | ${stars} | ${sig} | ${c.scoreVal} |`);
  });
  lines.push("");
  lines.push("---");
  lines.push("");
  ranked.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.slug}  ·  score ${c.scoreVal}`);
    lines.push("");
    lines.push(`- **Link:** https://github.com/${c.slug}`);
    if (c.meta) {
      lines.push(`- **Stars:** ${c.meta.stars.toLocaleString()}  ·  **Lang:** ${c.meta.language || "—"}  ·  **Created:** ${(c.meta.createdAt || "").slice(0, 10)}  ·  **Last push:** ${(c.meta.pushedAt || "").slice(0, 10)}`);
      if (c.meta.topics.length) lines.push(`- **Topics:** ${c.meta.topics.join(", ")}`);
      if (c.meta.homepage) lines.push(`- **Homepage:** ${c.meta.homepage}`);
    }
    if (c.hn) lines.push(`- **HN:** ${c.hn.points} points — "${c.hn.title}" (${c.hn.hnUrl})`);
    lines.push(`- **Post seed:** ${angleSeed(c)}`);
    lines.push("");
  });
  lines.push(renderProductHunt(ph));
  return lines.join("\n");
}

async function main() {
  loadEnv();
  const { dryRun, date, top } = parseArgs();
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error("Missing env var: FIRECRAWL_API_KEY");
    process.exit(1);
  }

  console.log(`▸ Repo radar ${date}`);
  console.log("─── sources ────────────────────────────────");
  const [hn, trending, ph] = await Promise.all([
    fetchHackerNews(), fetchTrending(apiKey), fetchProductHunt(apiKey),
  ]);

  // Merge into one candidate set.
  const candidates = new Map();
  for (const [slug, hnData] of hn) {
    candidates.set(slug, { slug, hn: hnData, trending: null, meta: null });
  }
  for (const [slug, tData] of trending) {
    if (!candidates.has(slug)) candidates.set(slug, { slug, hn: null, trending: null, meta: null });
    candidates.get(slug).trending = tData;
  }
  console.log("─── enrich ─────────────────────────────────");
  console.log(`  ${candidates.size} unique repos to enrich via GitHub API`);

  let rateLimited = false;
  for (const c of candidates.values()) {
    if (rateLimited) break;
    const meta = await enrich(c.slug);
    if (meta?.rateLimited) { rateLimited = true; console.log("  ⚠ GitHub API rate-limited — set GITHUB_TOKEN to enrich more"); break; }
    if (meta?.dead) { candidates.delete(c.slug); continue; }
    c.meta = meta;
  }

  const scored = [...candidates.values()].map((c) => {
    c.rel = relevance(c);
    return c;
  });
  const kept = scored.filter(isRelevant);
  const dropped = scored.length - kept.length;
  console.log(`  ${kept.length} relevant · ${dropped} off-topic dropped`);

  const ranked = kept
    .map((c) => ({ ...c, scoreVal: score(c) }))
    .sort((a, b) => b.scoreVal - a.scoreVal)
    .slice(0, top);

  console.log("─── top candidates ─────────────────────────");
  ranked.slice(0, 12).forEach((c, i) => {
    const stars = c.meta ? `${(c.meta.stars / 1000).toFixed(1)}k★` : "?";
    console.log(`  ${String(i + 1).padStart(2)}. ${c.slug.padEnd(34)} ${String(c.scoreVal).padStart(5)}  ${stars}`);
  });

  console.log(`─── product hunt ───────────────────────────`);
  console.log(`  ${ph.size} design/marketing products captured`);

  if (dryRun) {
    console.log("\n✓ Dry run — no file written.");
    return;
  }

  const report = renderReport(date, ranked, ph);
  const outDir = join(ROOT, "intel", "radar");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${date}.md`);
  writeFileSync(outPath, report, "utf8");
  console.log(`\n✓ Wrote ${outPath} (${(report.length / 1024).toFixed(1)} KB, ${ranked.length} candidates)`);
}

main().catch((err) => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
