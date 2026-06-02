// Firecrawl API client — v2 /scrape. Plain ESM JS, no TS, no tsx.
// Reference: https://docs.firecrawl.dev/api-reference/endpoint/scrape

const API_BASE = "https://api.firecrawl.dev/v2";

export async function scrape({ apiKey, url, onlyMainContent = true, waitFor = 0 }) {
  const body = { url, formats: ["markdown"], onlyMainContent };
  if (waitFor) body.waitFor = waitFor; // ms to wait for JS-heavy pages (e.g. Product Hunt)
  const res = await fetch(`${API_BASE}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Firecrawl scrape failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (!json.success || !json.data?.markdown) {
    throw new Error(`Firecrawl returned no markdown: ${json.error ?? "unknown"}`);
  }
  return { markdown: json.data.markdown, metadata: json.data.metadata ?? {} };
}
