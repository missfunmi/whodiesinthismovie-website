/**
 * Standalone Claude test script — run without deploying anything.
 *
 * Replicates the exact Wikipedia fetch + Claude extraction the production
 * ingestion worker uses (HTML parsing with cheerio, Plot section extraction).
 *
 * Usage:
 *   npx tsx scripts/test-gemini.ts "<movie title> [year]"
 *
 * Examples:
 *   npx tsx scripts/test-gemini.ts "After the Hunt 2025"
 *   npx tsx scripts/test-gemini.ts "Sinners 2025"
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";

const [, , titleWithYear, model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5"] =
  process.argv;

// Parse optional year suffix: "Sinners 2025" → title="Sinners", year=2025
const yearMatch = titleWithYear?.match(/^(.+?)\s+(\d{4})$/);
const title = yearMatch ? yearMatch[1] : titleWithYear;
const year = yearMatch ? parseInt(yearMatch[2]) : undefined;

if (!title) {
  console.error('Usage: npx tsx scripts/test-gemini.ts "<title> [year]"\n  e.g. npx tsx scripts/test-gemini.ts "Sinners 2025"');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set in .env");
  process.exit(1);
}

async function fetchWikipediaPlot(movieTitle: string, movieYear?: number): Promise<string | null> {
  const pageVariants = [
    ...(movieYear ? [`${movieTitle} (${movieYear} film)`] : []),
    `${movieTitle} (film)`,
    movieTitle,
  ];

  for (const pageTitle of pageVariants) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=extracts&exsectionformat=plain&format=json`;
    console.log(`[wikipedia] Trying "${pageTitle}"...`);

    const res = await fetch(url, {
      headers: { "User-Agent": "WDITMBot/1.0 (test script)" },
    });
    if (!res.ok) continue;

    const data = await res.json() as { query: { pages: Record<string, { extract?: string; missing?: boolean }> } };
    const page = Object.values(data.query.pages)[0];
    if (!page || page.missing || !page.extract) continue;

    const extractHtml = page.extract.slice(0, 100_000);
    const $ = cheerio.load(extractHtml);
    const fullPageText = $("body").text().trim().slice(0, 20_000);

    const plotHeader = $("h2, h3")
      .filter((_, el) => $(el).text().toLowerCase().includes("plot"))
      .first();

    let plotText = "";
    if (plotHeader.length) {
      plotText = plotHeader
        .nextUntil("h2, h3")
        .filter("p")
        .map((_, el) => $(el).text().trim())
        .get()
        .join("\n\n");
    }

    if (plotText.length > 100) {
      const content = plotText.slice(0, 8000);
      console.log(`[wikipedia] Found Plot section: ${content.length} chars\n`);
      return content;
    }

    if (fullPageText.length > 200) {
      const content = fullPageText.slice(0, 8000);
      console.log(`[wikipedia] No Plot section, using full extract: ${content.length} chars\n`);
      return content;
    }
  }

  return null;
}

async function main() {
  console.log(`Movie: "${title}"${year ? ` (${year})` : ""}  |  Model: ${model}\n`);

  const plot = await fetchWikipediaPlot(title, year);
  if (!plot) {
    console.error("Could not fetch Wikipedia plot.");
    process.exit(1);
  }

  const prompt = `Extract ALL character deaths from this text about the movie "${title}".
Return ONLY a valid JSON array of objects. Each object must have these exact fields:
- character (string): character name
- timeOfDeath (string): when they died (e.g. "Opening scene", "Act 2", "Final act")
- cause (string): how they died
- killedBy (string): who killed them (use "N/A" if not applicable)
- context (string): 1-2 sentence summary
- isAmbiguous (boolean): true if death is unclear/off-screen

Example format:
[{"character":"John","timeOfDeath":"Act 3","cause":"Gunshot","killedBy":"Villain","context":"Shot during the final battle.","isAmbiguous":false}]

If no deaths, return: []
Return ONLY valid JSON. No other text.

Text:
${plot}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log("Calling Claude...\n");
  const response = await client.messages.create({
    model,
    max_tokens: 16_000,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  console.log("=== Response ===");
  console.log("text:", block?.type === "text" ? block.text.slice(0, 800) : "(empty)");
  console.log("stop_reason:", response.stop_reason);
  console.log("usage:", JSON.stringify(response.usage, null, 2));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
