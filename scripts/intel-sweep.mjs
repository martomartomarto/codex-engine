// Weekly intel sweep — scrapes the configured targets and writes a single
// dated markdown report to intel/output/. Plain ESM JS (no TS, no tsx).
//
// Called by .github/workflows/intel-weekly.yml on cron (Mondays 09:00 UTC).
// Reads intel/targets.json (edit that file to change scope).
//
// Flags:
//   --dry-run         Print plan + first 500 chars of each scrape, don't write file
//   --date YYYY-MM-DD Override today's date

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scrape } from "../lib/firecrawl.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  return {
    dryRun: args.includes("--dry-run"),
    date: (() => {
      const i = args.indexOf("--date");
      if (i >= 0 && args[i + 1]) return args[i + 1];
      return new Date().toISOString().slice(0, 10);
    })(),
  };
}

function loadTargets() {
  const raw = readFileSync(join(ROOT, "intel", "targets.json"), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) {
    throw new Error("No targets configured in intel/targets.json");
  }
  return parsed.targets;
}

async function sweepOne(apiKey, target) {
  try {
    const data = await scrape({ apiKey, url: target.url });
    return { target, ok: true, data };
  } catch (err) {
    return { target, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function renderReport(date, results) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  const byTag = new Map();
  for (const r of ok) {
    const tag = r.target.tag || "untagged";
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(r);
  }

  const lines = [];
  lines.push(`# Intel Sweep — ${date}`);
  lines.push("");
  lines.push(`**Targets:** ${results.length} (${ok.length} ok, ${failed.length} failed)`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");

  for (const tag of Array.from(byTag.keys()).sort()) {
    lines.push("---");
    lines.push("");
    lines.push(`## ${tag}`);
    lines.push("");
    for (const r of byTag.get(tag)) {
      lines.push(`### ${r.target.label}`);
      lines.push("");
      lines.push(`- **URL:** ${r.target.url}`);
      if (r.data?.metadata?.title) lines.push(`- **Title:** ${r.data.metadata.title}`);
      if (r.target.note) lines.push(`- **Note:** ${r.target.note}`);
      lines.push("");
      lines.push(r.data?.markdown.trim() ?? "");
      lines.push("");
    }
  }

  if (failed.length) {
    lines.push("---");
    lines.push("");
    lines.push("## Failures");
    lines.push("");
    for (const r of failed) {
      lines.push(`- ❌ **${r.target.label}** (${r.target.url}) — ${r.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  loadEnv();
  const { dryRun, date } = parseArgs();

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error("Missing env var: FIRECRAWL_API_KEY");
    process.exit(1);
  }

  const targets = loadTargets();
  console.log(`▸ Intel sweep ${date} — ${targets.length} targets`);
  console.log("───────────────────────────────────────────");

  const results = [];
  for (const target of targets) {
    const start = Date.now();
    const result = await sweepOne(apiKey, target);
    const ms = Date.now() - start;
    results.push(result);
    if (result.ok) {
      const len = result.data.markdown.length;
      console.log(`  ✓ ${target.label.padEnd(22)} ${(len / 1024).toFixed(1).padStart(6)} KB  (${ms}ms)`);
    } else {
      console.log(`  ✗ ${target.label.padEnd(22)} ${result.error}`);
    }
  }

  console.log("───────────────────────────────────────────");

  if (dryRun) {
    console.log("\nDry-run preview (first 500 chars per target):\n");
    for (const r of results.filter((r) => r.ok)) {
      console.log(`── ${r.target.label} ──`);
      console.log(r.data.markdown.slice(0, 500));
      console.log("");
    }
    console.log("✓ Dry run — no file written.");
    return;
  }

  const report = renderReport(date, results);
  const outDir = join(ROOT, "intel", "output");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${date}.md`);
  writeFileSync(outPath, report, "utf8");

  console.log(`✓ Wrote ${outPath} (${(report.length / 1024).toFixed(1)} KB)`);
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) console.log(`⚠ ${failed} target(s) failed — see Failures section.`);
}

main().catch((err) => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
