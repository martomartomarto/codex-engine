// Firecrawl API client — v2 /scrape. Plain ESM JS, no TS, no tsx.
// Reference: https://docs.firecrawl.dev/api-reference/endpoint/scrape

const API_BASE = "https://api.firecrawl.dev/v2";

export async function scrape({ apiKey, url, onlyMainContent = true }) {
  const res = await fetch(`${API_BASE}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent }),
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
