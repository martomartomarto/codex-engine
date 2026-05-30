// Renders branded 1200x1200 PNG cards for LinkedIn posts via headless Chrome.
// One card per post, defined as data below. Brand replicated from codex-v1
// (opengraph-image.tsx + codex-mark.tsx): #0a0a0a bg, #e8e8e6 text,
// amber #c8a84b accent, Inter + Space Mono.
//
//   node scripts/render-cards.mjs            # render all
//   node scripts/render-cards.mjs 2026-06-05 # render one
//
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "posts", "assets");
const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ── Card data ───────────────────────────────────────────────────────────
const CARDS = [
  {
    date: "2026-06-01",
    type: "statement",
    eyebrow: "The shift · 2026",
    headline: `Infrastructure runs<br>whether you show up<br><span class="am">or not.</span>`,
    kicker: "AI stopped being a feature. It became the system.",
  },
  {
    date: "2026-06-05",
    type: "list",
    eyebrow: "Stack · by task",
    title: `The repos I actually run`,
    rows: [
      { label: "orchestrate", text: "CrewAI" },
      { label: "web → data", text: "Firecrawl" },
      { label: "no API", text: "browser-use" },
      { label: "connect stack", text: "MCP servers" },
      { label: "deep research", text: "open-deep-research" },
    ],
    kicker: "Free. Open source. The moat is the wiring.",
  },
  {
    date: "2026-06-08",
    type: "statement",
    eyebrow: "Case · win / loss",
    headline: `Analysis stopped being<br>an event. It became a<br><span class="am">property of the system.</span>`,
    kicker: "Win/loss runs nightly — not quarterly.",
  },
  {
    date: "2026-06-12",
    type: "list",
    eyebrow: "Build · research agent",
    title: `Prospect research, automated`,
    rows: [
      { label: "crawl", text: "Firecrawl — site → clean text" },
      { label: "no API", text: "browser-use — LinkedIn, news" },
      { label: "reason", text: "a loop that plans & digs" },
    ],
    kicker: "~200 lines over 3 free repos → a 1-page brief.",
  },
  {
    date: "2026-06-15",
    type: "statement",
    eyebrow: "Case · budget",
    headline: `AI's best job in growth<br>isn't writing copy.<br>It's <span class="am">closing the loop.</span>`,
    kicker: "Spend → outcome, reallocated every week.",
  },
  {
    date: "2026-06-19",
    type: "statement",
    eyebrow: "Contrarian",
    headline: `Visible AI is usually<br><span class="am">low-leverage AI.</span>`,
    kicker: "Ask what runs when nobody's logged in.",
  },
  {
    date: "2026-06-22",
    type: "statement",
    eyebrow: "Case · memory",
    headline: `The model is a commodity.<br>The <span class="am">memory</span> is the moat.`,
    kicker: "Context that survives every session.",
  },
  {
    date: "2026-06-26",
    type: "list",
    eyebrow: "Q2 · stack review",
    title: `Adopted vs ignored`,
    rows: [
      { heading: "Adopted" },
      { full: "Firecrawl · browser-use · MCP" },
      { heading: "Skipped" },
      { full: "n8n · all-in-one platforms · heavy frameworks" },
    ],
    kicker: "Keep primitives you compose. Drop abstractions that hide the system.",
  },
  {
    date: "2026-06-29",
    type: "list",
    eyebrow: "The method",
    title: `Stop using AI. Operate with it.`,
    rows: [
      { label: "01", text: "Contract — write the business down" },
      { label: "02", text: "Memory — survives sessions" },
      { label: "03", text: "Connectors — MCP to your stack" },
      { label: "04", text: "Pipelines — work that runs without you" },
      { label: "05", text: "Orchestration — which model/repo per job" },
    ],
    kicker: "The model is commodity. The system is the moat.",
  },
];

// ── HTML template ───────────────────────────────────────────────────────
function rowsHtml(rows) {
  return rows
    .map((r) =>
      r.heading
        ? `<div class="rhead">${r.heading}</div>`
        : r.full
          ? `<div class="full">${r.full}</div>`
          : `<div class="row"><span class="lbl">${r.label}</span><span class="txt">${r.text}</span></div>`,
    )
    .join("");
}

function html(card) {
  const middle =
    card.type === "statement"
      ? `<div class="headline">${card.headline}</div>`
      : `<div class="title">${card.title}</div><div class="rows">${rowsHtml(card.rows)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=block" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1200px; height:1200px; overflow:hidden; }
  body {
    background:#0a0a0a; color:#e8e8e6;
    font-family:'Inter',-apple-system,'Helvetica Neue',sans-serif;
    padding:96px 90px; display:flex; flex-direction:column;
    -webkit-font-smoothing:antialiased;
  }
  .am { color:#c8a84b; }
  .eyebrow {
    font-family:'Space Mono',ui-monospace,monospace;
    font-size:23px; letter-spacing:0.16em; text-transform:uppercase;
    color:#8f8f8a; display:flex; align-items:center; gap:18px;
  }
  .eyebrow::before { content:""; width:30px; height:3px; background:#c8a84b; }
  .mid { flex:1; display:flex; flex-direction:column; justify-content:center; }
  .headline {
    font-weight:600; font-size:62px; line-height:1.1;
    letter-spacing:-0.035em; color:#e8e8e6;
  }
  .title {
    font-weight:600; font-size:46px; line-height:1.1;
    letter-spacing:-0.03em; color:#e8e8e6; margin-bottom:52px;
  }
  .rows { display:flex; flex-direction:column; gap:30px; }
  .row { display:grid; grid-template-columns:260px 1fr; align-items:baseline; }
  .lbl {
    font-family:'Space Mono',ui-monospace,monospace; font-size:22px;
    letter-spacing:0.04em; color:#c8a84b; text-transform:uppercase;
  }
  .txt { font-size:36px; font-weight:500; color:#e2e2de; letter-spacing:-0.02em; }
  .full { font-size:38px; font-weight:500; color:#e2e2de; letter-spacing:-0.02em; }
  .rhead {
    font-family:'Space Mono',ui-monospace,monospace; font-size:20px;
    letter-spacing:0.16em; text-transform:uppercase; color:#8f8f8a;
  }
  .rhead:not(:first-child) { margin-top:26px; }
  .kicker { font-size:27px; color:#9a9a95; line-height:1.4; max-width:880px; }
  .footer {
    display:flex; align-items:center; justify-content:space-between;
    border-top:1px solid #2a2a27; padding-top:30px; margin-top:44px;
  }
  .lockup { display:flex; align-items:center; gap:16px; }
  .mark { position:relative; width:48px; height:48px; display:flex; align-items:center; justify-content:center; }
  .mark .c { font-size:40px; font-weight:800; letter-spacing:-0.04em; color:#e8e8e6; line-height:1; }
  .mark .u { position:absolute; bottom:7px; left:50%; transform:translateX(-50%); width:18px; height:3px; background:#c8a84b; }
  .word { font-size:31px; font-weight:600; letter-spacing:-0.025em; color:#e8e8e6; }
  .url { display:flex; align-items:center; gap:13px; font-size:21px; color:#b8b8b4; letter-spacing:0.02em; }
  .dot { width:10px; height:10px; border-radius:999px; background:#5ea676; }
</style></head>
<body>
  <div class="eyebrow">${card.eyebrow}</div>
  <div class="mid">${middle}</div>
  ${card.kicker ? `<div class="kicker">${card.kicker}</div>` : ""}
  <div class="footer">
    <div class="lockup">
      <span class="mark"><span class="c">C</span><span class="u"></span></span>
      <span class="word">Codex</span>
    </div>
    <div class="url"><span class="dot"></span>codex-os.vercel.app</div>
  </div>
</body></html>`;
}

// ── Render ──────────────────────────────────────────────────────────────
function render(card) {
  const profile = mkdtempSync(join(tmpdir(), "codex-card-"));
  const htmlPath = join(profile, "card.html");
  const outPath = join(OUT_DIR, `${card.date}.png`);
  writeFileSync(htmlPath, html(card));
  // Chrome --headless=new writes the screenshot but does not always self-exit;
  // bound it with a timeout + SIGKILL. The PNG is flushed before the hang, so
  // a timeout kill is fine as long as the file exists afterward.
  try {
    execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-sandbox",
        "--force-device-scale-factor=2",
        "--window-size=1200,1200",
        "--virtual-time-budget=5000",
        `--user-data-dir=${profile}`,
        `--screenshot=${outPath}`,
        `file://${htmlPath}`,
      ],
      { stdio: "ignore", timeout: 9000, killSignal: "SIGKILL" },
    );
  } catch (err) {
    // ETIMEDOUT is expected (Chrome hung after writing). Only rethrow if the
    // PNG never landed.
    if (!existsSync(outPath)) {
      rmSync(profile, { recursive: true, force: true });
      throw new Error(`render failed for ${card.date}: ${err.message}`);
    }
  }
  rmSync(profile, { recursive: true, force: true });
  if (!existsSync(outPath)) throw new Error(`no PNG produced for ${card.date}`);
  return outPath;
}

mkdirSync(OUT_DIR, { recursive: true });
const only = process.argv[2];
const todo = only ? CARDS.filter((c) => c.date === only) : CARDS;
if (!todo.length) {
  console.error(only ? `No card for ${only}` : "No cards defined.");
  process.exit(1);
}
for (const card of todo) {
  const out = render(card);
  console.log(`✓ ${card.date} → ${out.replace(ROOT + "/", "")}`);
}
console.log(`Done — ${todo.length} card(s).`);
