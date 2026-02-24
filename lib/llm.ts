/**
 * Shared LLM module — Gemini only (primary LLM for production).
 *
 * Used by:
 *   - lib/ingestion.ts (which is used by the Vercel Cron route and the local dev worker)
 *
 * Config is passed as a parameter (not read from process.env) so the module
 * works in both Next.js and standalone Node.js contexts.
 *
 * Gemini free tier limits (as of 2025):
 *   - 5 requests per minute (RPM)
 *   - 250,000 tokens per minute (TPM)
 *   - 20 requests per day (RPD)
 *
 * Rate limiting note: The cron job runs every 15 minutes and processes one movie
 * per invocation, so at most 1 Gemini request per invocation = well within limits.
 * The local worker waits 500ms between jobs = max 2 req/min (within 5 RPM limit).
 */

import { GoogleGenAI } from "@google/genai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmConfig {
  geminiApiKey?: string;
  geminiModel?: string; // defaults to GEMINI_DEFAULT_MODEL if not set
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

const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_EXTRACTION_TIMEOUT_MS = 30_000;

// Retry configuration — 5 retries with exponential backoff
const GEMINI_MAX_RETRIES = 5;
const GEMINI_RETRY_DELAYS = [2_000, 4_000, 8_000, 16_000, 32_000]; // ms

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for recoverable Gemini errors that should be retried:
 *   - 429 (rate limited)
 *   - 500/502/503 (server errors)
 *   - JSON parsing failures (transient model output corruption)
 *
 * Returns false for non-retryable errors:
 *   - 400 (bad request — prompt issue)
 *   - 401/403 (authentication/authorization — config issue)
 *   - AbortError (request timeout — not worth retrying with same timeout)
 */
function isRetryableGeminiError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;

  const msg = error instanceof Error ? error.message : String(error);

  // Non-retryable auth/client errors
  if (msg.includes("401") || msg.includes("403") || msg.includes("400")) {
    return false;
  }

  // Retryable server/rate-limit errors
  if (
    msg.includes("429") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("quota")
  ) {
    return true;
  }

  // JSON parsing failures — could be transient model output corruption
  if (
    msg.includes("JSON") ||
    msg.toLowerCase().includes("parse") ||
    msg.includes("not a JSON array") ||
    msg.includes("SyntaxError")
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Gemini helper
// ---------------------------------------------------------------------------

async function callGemini(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  // GoogleGenAI reads GEMINI_API_KEY from the environment automatically
  const ai = new GoogleGenAI({});
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { abortSignal: controller.signal },
    });

    const text = response.text;

    if (!text) {
      throw new Error("Gemini returned empty response");
    }

    return text.trim();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini timeout");
    }
    throw error;
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
 * TODO — Skipping LLM validation of movie title for now — results very inconsistent, needs finetuning
 */
export async function validateMovieTitle(
  query: string,
  _config: LlmConfig,
): Promise<boolean> {
  console.log(`[llm:debug] Skipping LLM validation for "${query}" (disabled)`);
  return true;
}

/**
 * Extract/enrich structured death data using Gemini.
 * Retries up to GEMINI_MAX_RETRIES times on recoverable errors (429, 500/502/503, JSON parse).
 * Does NOT retry on auth errors (401/403) or timeouts.
 * Falls back to pre-parsed deaths if Gemini fails after all retries.
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

  // If we have parsed deaths but no plot summary, use them as-is (no enrichment needed)
  if (hasParsedDeaths && !hasPlot) {
    console.log(
      `[llm] Using ${scraped.parsedDeaths.length} parsed deaths (no plot summary available for enrichment)`,
    );
    return scraped.parsedDeaths;
  }

  // Skip LLM if Gemini API key is not configured
  if (!config.geminiApiKey) {
    console.log(
      `[llm] GEMINI_API_KEY not set — skipping LLM enrichment, using ${scraped.parsedDeaths.length} parsed deaths`,
    );
    return hasParsedDeaths ? scraped.parsedDeaths : [];
  }

  const model = config.geminiModel || GEMINI_DEFAULT_MODEL;
  const prompt =
    hasParsedDeaths && hasPlot
      ? buildEnrichmentPrompt(title, scraped)
      : buildExtractionPrompt(
          title,
          scraped.plotSummary || scraped.fandomContent,
        );

  // Retry loop — up to GEMINI_MAX_RETRIES attempts with exponential backoff
  for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[llm:gemini] Calling Gemini for death extraction (attempt ${attempt + 1}/${GEMINI_MAX_RETRIES}, model: ${model})...`,
      );

      const raw = await callGemini(prompt, model, GEMINI_EXTRACTION_TIMEOUT_MS);
      console.log(
        `[llm:gemini] Raw response (first 300 chars): ${raw.slice(0, 300)}`,
      );

      const deaths = parseDeathResponse(raw);
      console.log(`[llm:gemini] Extracted ${deaths.length} deaths`);

      // Sanity check: if Gemini returned significantly fewer deaths than parsed,
      // it likely truncated output — fall back to parsed deaths
      if (hasParsedDeaths && deaths.length < scraped.parsedDeaths.length * 0.8) {
        const llmNames = new Set(deaths.map((d) => d.character));
        const dropped = scraped.parsedDeaths
          .filter((d) => !llmNames.has(d.character))
          .map((d) => d.character);
        console.warn(
          `[llm:gemini] Enrichment dropped deaths (${deaths.length} vs ${scraped.parsedDeaths.length} parsed) — using parsed deaths. Dropped: ${dropped.join(", ")}`,
        );
        return scraped.parsedDeaths;
      }

      return deaths;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isLast = attempt === GEMINI_MAX_RETRIES - 1;

      if (isLast || !isRetryableGeminiError(error)) {
        // All retries exhausted, or non-retryable error (auth, timeout, etc.)
        if (isLast) {
          console.warn(
            `[llm:gemini] All ${GEMINI_MAX_RETRIES} attempts failed. Last error: ${msg}`,
          );
        } else {
          console.warn(
            `[llm:gemini] Non-retryable error (${msg}) — not retrying`,
          );
        }

        if (hasParsedDeaths) {
          console.warn(
            `[llm:gemini] Falling back to ${scraped.parsedDeaths.length} parsed deaths without enrichment`,
          );
          return scraped.parsedDeaths;
        }

        throw new Error(`LLM extraction failed after all attempts: ${msg}`);
      }

      const delay = GEMINI_RETRY_DELAYS[attempt] ?? 32_000;
      console.warn(
        `[llm:gemini] Attempt ${attempt + 1}/${GEMINI_MAX_RETRIES} failed (${msg}), retrying in ${delay / 1000}s...`,
      );
      await sleep(delay);
    }
  }

  // Should not reach here, but just in case
  return hasParsedDeaths ? scraped.parsedDeaths : [];
}
