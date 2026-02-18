/**
 * Shared LLM module — Gemini (primary) with Ollama fallback.
 *
 * Used by:
 *   - scripts/ingestion-worker.ts (import "../lib/llm.js")
 *
 * Config is passed as a parameter (not read from process.env) so the module
 * works in both Next.js and standalone Node.js contexts.
 */

import { GoogleGenAI } from "@google/genai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmConfig {
  geminiApiKey?: string;
  geminiModel?: string;
  ollamaEndpoint: string;
  ollamaModel: string;
}

export interface ExtractedDeath {
  character: string;
  timeOfDeath: string;
  cause: string;
  killedBy: string;
  context: string;
  isAmbiguous: boolean;
}

export interface ScrapedContent {
  parsedDeaths: ExtractedDeath[];
  fandomContent: string;
  plotSummary: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_VALIDATION_TIMEOUT_MS = 8_000;
const GEMINI_EXTRACTION_TIMEOUT_MS = 30_000;

const OLLAMA_INACTIVITY_TIMEOUT_MS = 30_000;
const OLLAMA_MAX_TOTAL_MS = 180_000;
const OLLAMA_VALIDATION_TIMEOUT_MS = 5_000;

const LLM_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Gemini helpers
// ---------------------------------------------------------------------------

async function callGemini(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  // The model reads the GEMINI_API_KEY from the environment,
  // so it doesn't need to be passed in
  const ai = new GoogleGenAI({});
  const request = ai.models.generateContent({
    model,
    contents: prompt,
  });

  const response = await Promise.race([
    request,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Gemini timeout")), timeoutMs),
    ),
  ]);

  const text = response.text;

  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Ollama helpers
// ---------------------------------------------------------------------------

async function callOllamaStreaming(
  endpoint: string,
  model: string,
  prompt: string,
): Promise<string> {
  const controller = new AbortController();
  const startTime = Date.now();

  const totalTimeout = setTimeout(() => controller.abort(), OLLAMA_MAX_TOTAL_MS);

  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(
      () => controller.abort(),
      OLLAMA_INACTIVITY_TIMEOUT_MS,
    );
  };

  try {
    resetInactivityTimer();

    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: { num_ctx: 8192 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Ollama returned ${response.status}: ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error("Ollama response has no body (streaming not supported?)");
    }

    let accumulated = "";
    const decoder = new TextDecoder();

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      resetInactivityTimer();
      const text = decoder.decode(chunk, { stream: true });

      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            accumulated += parsed.response;
          }
          if (parsed.done) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(
              `[llm:ollama] Streaming complete in ${elapsed}s (${accumulated.length} chars)`,
            );
            return accumulated.trim();
          }
        } catch {
          // Partial JSON line — will be completed in next chunk
        }
      }
    }

    return accumulated.trim();
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("aborted") || msg.includes("abort")) {
      throw new Error(`Ollama inactivity/total timeout after ${elapsed}s`);
    }
    throw error;
  } finally {
    clearTimeout(totalTimeout);
    if (inactivityTimer) clearTimeout(inactivityTimer);
  }
}

async function callOllamaNonStreaming(
  endpoint: string,
  model: string,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Ollama returned ${response.status}: ${response.statusText}`,
      );
    }

    const data = await response.json();
    return ((data.response as string) || "").trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// JSON parsing & repair
// ---------------------------------------------------------------------------

function repairLlmJson(json: string): string {
  let repaired = json.trim();

  if (repaired.startsWith("[") && repaired.includes('"character"')) {
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      repaired = repaired
        .replace(/\]\s*,?\s*\n\s*\[/g, "},{")
        .replace(/^\[\s*"(?=\w+"\s*:)/, '[{"')
        .replace(/"\s*\]$/, '"}]')
        .replace(/(true|false|\d+)\s*\]$/, "$1}]");
    }
  }

  return repaired;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function validateDeathRecord(d: Record<string, unknown>): ExtractedDeath {
  return {
    character: decodeHtmlEntities(String(d.character || "Unknown")),
    timeOfDeath: decodeHtmlEntities(String(d.timeOfDeath || "Unknown")),
    cause: decodeHtmlEntities(String(d.cause || "Unknown")),
    killedBy:
      d.killedBy && String(d.killedBy).trim()
        ? decodeHtmlEntities(String(d.killedBy))
        : "N/A",
    context: decodeHtmlEntities(String(d.context || "")),
    isAmbiguous: Boolean(d.isAmbiguous),
  };
}

function parseDeathResponse(raw: string): ExtractedDeath[] {
  // Strip markdown code fences if present
  let cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Try to extract JSON array from the response if it's wrapped in other text
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    cleaned = arrayMatch[0];
  }

  cleaned = repairLlmJson(cleaned);

  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error("LLM response is not a JSON array");
  }

  return parsed.map((d: Record<string, unknown>) => validateDeathRecord(d));
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildEnrichmentPrompt(
  title: string,
  scraped: ScrapedContent,
): string {
  const deathSummary = scraped.parsedDeaths
    .map((d, i) => `${i + 1}. ${d.character} — ${d.cause}`)
    .join("\n");

  return `Here are the character deaths from the movie "${title}":

DEATH LIST:
${deathSummary}

PLOT SUMMARY:
${scraped.plotSummary.slice(0, 4000)}

For EACH death listed above, provide additional details from the plot summary.
Return ONLY a valid JSON array with one object per death. Each object must have:
- character (string): exact character name from the death list
- timeOfDeath (string): when in the movie (e.g. "Opening scene", "Act 2", "Final act", "~45 minutes in"). Use "Unknown" only if truly unclear
- cause (string): how they died (from the death list)
- killedBy (string): who/what killed them. Use "N/A" for accidents/natural causes
- context (string): 1-2 sentence summary of the circumstances from the plot
- isAmbiguous (boolean): true if death is off-screen/uncertain/only mentioned

You MUST include ALL ${scraped.parsedDeaths.length} deaths. Do not skip any.
Return ONLY valid JSON. No other text.`;
}

function buildExtractionPrompt(title: string, content: string): string {
  return `Extract ALL character deaths from this text about the movie "${title}".
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
${content.slice(0, 6000)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate whether a query is a real movie.
 * Tries Gemini first, falls back to Ollama. Returns true if both fail (best-effort).
 * TODO — Skipping LLM validation of movie title for now — results very inconsistent, needs finetuning
 */
export async function validateMovieTitle(
  query: string,
  config: LlmConfig,
): Promise<boolean> {
  console.log("[llm:debug] Skipping LLM validation of movie title for now...");
  return true;
  /*
  const prompt = `Is '${query}' a real movie? Answer with only YES or NO.`;

  // Try Gemini first
  if (config.geminiApiKey && config.geminiModel) {
    try {
      console.log(`[llm:gemini] Calling Gemini to validate movie title...`);
      const answer = await callGemini(
        prompt,
        config.geminiModel,
        GEMINI_VALIDATION_TIMEOUT_MS,
      );
      const isRealMovie = answer.toUpperCase().startsWith("YES");
      console.log(
        `[llm:gemini] Validation for "${query}": ${answer.slice(0, 20)} (isRealMovie: ${isRealMovie})`,
      );
      return isRealMovie;
    } catch (error) {
      console.log(
        `[llm:gemini] Validation failed, falling back to Ollama: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // Ollama fallback
  try {
    const answer = await callOllamaNonStreaming(
      config.ollamaEndpoint,
      config.ollamaModel,
      prompt,
      OLLAMA_VALIDATION_TIMEOUT_MS,
    );
    const isRealMovie = answer.toUpperCase().startsWith("YES");
    console.log(
      `[llm:ollama] Validation for "${query}": ${answer.slice(0, 20)} (isRealMovie: ${isRealMovie})`,
    );
    return isRealMovie;
  } catch {
    console.log(
      "[llm] Validation skipped (both Gemini and Ollama unavailable)",
    );
    return true; // Best-effort — proceed if both LLMs are down
  }
  */
}

/**
 * Extract/enrich structured death data using an LLM.
 * Tries Gemini first, falls back to Ollama, with retries.
 */
export async function extractDeaths(
  title: string,
  scraped: ScrapedContent,
  config: LlmConfig,
): Promise<ExtractedDeath[]> {
  const hasPlot = scraped.plotSummary.trim().length > 0;
  const hasParsedDeaths = scraped.parsedDeaths.length > 0;
  const hasAnyContent = scraped.fandomContent.length > 0 || hasPlot;

  if (!hasAnyContent && !hasParsedDeaths) {
    console.log(
      `[llm] No content to extract deaths from — zero-death movie`,
    );
    return [];
  }

  // If we have parsed deaths but no plot summary, use them as-is
  if (hasParsedDeaths && !hasPlot) {
    console.log(
      `[llm] Using ${scraped.parsedDeaths.length} parsed deaths (no plot summary available for enrichment)`,
    );
    return scraped.parsedDeaths;
  }

  const prompt =
    hasParsedDeaths && hasPlot
      ? buildEnrichmentPrompt(title, scraped)
      : buildExtractionPrompt(
          title,
          scraped.plotSummary || scraped.fandomContent,
        );

  // Try Gemini first (if available)
  if (config.geminiApiKey && config.geminiModel) {
    try {
      console.log(`[llm:gemini] Calling Gemini for death extraction...`);
      const raw = await callGemini(
        prompt,
        config.geminiModel,
        GEMINI_EXTRACTION_TIMEOUT_MS,
      );
      console.log(
        `[llm:gemini] Raw response (first 300 chars): ${raw.slice(0, 300)}`,
      );
      const deaths = parseDeathResponse(raw);
      console.log(`[llm:gemini] Extracted ${deaths.length} deaths`);
      // Sanity check: if LLM returned significantly fewer deaths than parsed,
      // it likely truncated output — fall back to parsed deaths
      if (hasParsedDeaths && deaths.length < scraped.parsedDeaths.length * 0.8) {
        const llmNames = new Set(deaths.map(d => d.character));
        const dropped = scraped.parsedDeaths.filter(d => !llmNames.has(d.character)).map(d => d.character);
        console.warn(
          `[llm:gemini] Enrichment dropped deaths (${deaths.length} vs ${scraped.parsedDeaths.length} parsed) — using parsed deaths. Dropped: ${dropped.join(", ")}`,
        );
        return scraped.parsedDeaths;
      }
      return deaths;
    } catch (error) {
      console.log(
        `[llm:gemini] Extraction failed, falling back to Ollama: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // Ollama fallback with retries
  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[llm:ollama] Calling Ollama (attempt ${attempt + 1}/${LLM_MAX_RETRIES}, model: ${config.ollamaModel})`,
      );

      const raw = await callOllamaStreaming(
        config.ollamaEndpoint,
        config.ollamaModel,
        prompt,
      );
      console.log(
        `[llm:ollama] Raw response (first 300 chars): ${raw.slice(0, 300)}`,
      );

      const deaths = parseDeathResponse(raw);
      console.log(`[llm:ollama] Extracted ${deaths.length} deaths`);
      // Sanity check: if LLM returned significantly fewer deaths than parsed,
      // it likely truncated output — fall back to parsed deaths
      if (hasParsedDeaths && deaths.length < scraped.parsedDeaths.length * 0.8) {
        const llmNames = new Set(deaths.map(d => d.character));
        const dropped = scraped.parsedDeaths.filter(d => !llmNames.has(d.character)).map(d => d.character);
        console.warn(
          `[llm:ollama] Enrichment dropped deaths (${deaths.length} vs ${scraped.parsedDeaths.length} parsed) — using parsed deaths. Dropped: ${dropped.join(", ")}`,
        );
        return scraped.parsedDeaths;
      }
      return deaths;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (
        msg.includes("aborted") ||
        msg.includes("abort") ||
        msg.includes("inactivity")
      ) {
        console.warn(
          `[llm:ollama] Timeout (attempt ${attempt + 1}): ${msg}`,
        );
      } else if (msg.includes("JSON")) {
        console.warn(
          `[llm:ollama] Invalid JSON (attempt ${attempt + 1}): ${msg}`,
        );
      } else {
        console.warn(
          `[llm:ollama] Error (attempt ${attempt + 1}): ${msg}`,
        );
      }

      if (attempt === LLM_MAX_RETRIES - 1) {
        if (hasParsedDeaths) {
          console.warn(
            `[llm] Both LLMs failed, falling back to ${scraped.parsedDeaths.length} parsed deaths without enrichment`,
          );
          return scraped.parsedDeaths;
        }
        throw new Error(
          `LLM extraction failed after all attempts: ${msg}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  return hasParsedDeaths ? scraped.parsedDeaths : [];
}
