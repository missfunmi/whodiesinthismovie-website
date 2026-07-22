/**
 * Standalone Gemini test script — run without deploying anything.
 *
 * Usage:
 *   npx tsx scripts/test-gemini.ts "<movie title>" [model]
 *
 * Examples:
 *   npx tsx scripts/test-gemini.ts "After the Hunt"
 *   npx tsx scripts/test-gemini.ts "After the Hunt" gemini-2.5-flash
 *
 * Fetches the Wikipedia plot summary, builds the same extraction prompt the
 * ingestion worker uses, calls Gemini with all four harm categories set to
 * BLOCK_NONE, and prints the full response including any block reasons.
 */

import "dotenv/config";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";

const [, , title, model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"] =
  process.argv;

if (!title) {
  console.error("Usage: npx tsx scripts/test-gemini.ts <movie title> [model]");
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not set in .env");
  process.exit(1);
}

async function fetchWikipediaPlot(movieTitle: string): Promise<string | null> {
  for (const pageTitle of [`${movieTitle} (film)`, movieTitle]) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=false&explaintext=true&titles=${encodeURIComponent(pageTitle)}&format=json&origin=*`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      query: { pages: Record<string, { extract?: string; missing?: boolean }> };
    };
    const page = Object.values(data.query.pages)[0];
    if (!page.missing && page.extract) {
      const plotStart = page.extract.indexOf("Plot");
      const extract =
        plotStart !== -1 ? page.extract.slice(plotStart) : page.extract;
      console.log(`[wikipedia] "${pageTitle}" — ${extract.length} chars\n`);
      return extract.slice(0, 6000);
    }
  }
  return null;
}

async function main() {
  console.log(`Movie: "${title}"  |  Model: ${model}\n`);

  const plot = await fetchWikipediaPlot(title);
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

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  console.log("Calling Gemini (all safety categories set to BLOCK_NONE)...\n");
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { safetySettings },
  });

  console.log("=== Response ===");
  console.log("text:", response.text?.slice(0, 500) ?? "(empty)");
  console.log("finishReason:", response.candidates?.[0]?.finishReason ?? "none");
  console.log("promptFeedback:", JSON.stringify(response.promptFeedback ?? null, null, 2));
  console.log("safetyRatings:", JSON.stringify(response.candidates?.[0]?.safetyRatings ?? [], null, 2));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
