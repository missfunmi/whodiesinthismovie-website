/**
 * Shared LLM module — Anthropic Claude (primary LLM for production).
 *
 * Used by:
 *   - lib/ingestion.ts (which is used by the ingestion worker and Inngest function)
 *
 * Config is passed as a parameter (not read from process.env) so the module
 * works in both Next.js and standalone Node.js contexts.
 */

import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmConfig {
  anthropicApiKey?: string;
  anthropicModel?: string;
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

const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_EXTRACTION_TIMEOUT_MS = 30_000;

const ANTHROPIC_MAX_RETRIES = 5;
const ANTHROPIC_RETRY_DELAYS = [2_000, 4_000, 8_000, 16_000, 32_000]; // ms

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
 * Returns true for recoverable Anthropic errors that should be retried:
 *   - 429 (rate limited)
 *   - 500+ (server errors)
 *   - JSON parsing failures (transient model output corruption)
 *
 * Returns false for non-retryable errors:
 *   - 400 (bad request)
 *   - 401 (authentication)
 *   - 403 (permission denied)
 *   - Timeout (not worth retrying with the same timeout)
 */
function isRetryableError(error: unknown): boolean {
  // SDK-typed exceptions — most specific first
  if (error instanceof Anthropic.RateLimitError) return true;
  if (error instanceof Anthropic.AuthenticationError) return false;
  if (error instanceof Anthropic.BadRequestError) return false;

  // Remaining API errors — check status code
  if (error instanceof Anthropic.APIError) {
    if (error.status >= 500) return true;
    // 403, 404, and other 4xx — not retryable
    return false;
  }

  // Connection errors (includes timeouts) — not worth retrying
  if (error instanceof Anthropic.APIConnectionError) return false;

  // JSON parsing failures — transient model output corruption, worth retrying
  const msg = error instanceof Error ? error.message : String(error);
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
// Claude helper
// ---------------------------------------------------------------------------

async function callClaude(
  client: Anthropic,
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const response = await client.messages.create(
    {
      model,
      max_tokens: 16_000,
      messages: [{ role: "user", content: prompt }],
    },
    { timeout: timeoutMs },
  );

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text" || !block.text) {
    throw new Error(
      `Claude returned empty response (stop_reason: ${response.stop_reason})`,
    );
  }

  return block.text.trim();
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
  let cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

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
 * Skipping LLM validation — results inconsistent, needs fine-tuning.
 */
export async function validateMovieTitle(
  query: string,
  _config: LlmConfig,
): Promise<boolean> {
  console.log(`[llm:debug] Skipping LLM validation for "${query}" (disabled)`);
  return true;
}

/**
 * Extract/enrich structured death data using Claude.
 * Retries up to ANTHROPIC_MAX_RETRIES times on recoverable errors (429, 5xx, JSON parse).
 * Does NOT retry on auth errors or connection timeouts.
 * Falls back to pre-parsed deaths if Claude fails after all retries.
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
    console.log(`[llm] No content to extract deaths from — zero-death movie`);
    return [];
  }

  if (hasParsedDeaths && !hasPlot) {
    console.log(
      `[llm] Using ${scraped.parsedDeaths.length} parsed deaths (no plot summary available for enrichment)`,
    );
    return scraped.parsedDeaths;
  }

  if (!config.anthropicApiKey) {
    console.log(
      `[llm] ANTHROPIC_API_KEY not set — skipping LLM enrichment, using ${scraped.parsedDeaths.length} parsed deaths`,
    );
    return hasParsedDeaths ? scraped.parsedDeaths : [];
  }

  const model = config.anthropicModel || ANTHROPIC_DEFAULT_MODEL;
  const prompt =
    hasParsedDeaths && hasPlot
      ? buildEnrichmentPrompt(title, scraped)
      : buildExtractionPrompt(
          title,
          scraped.plotSummary || scraped.fandomContent,
        );

  // maxRetries: 0 — we manage our own retry loop below
  const client = new Anthropic({
    apiKey: config.anthropicApiKey,
    maxRetries: 0,
  });

  for (let attempt = 0; attempt < ANTHROPIC_MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[llm:claude] Calling Claude for death extraction (attempt ${attempt + 1}/${ANTHROPIC_MAX_RETRIES}, model: ${model})...`,
      );

      const raw = await callClaude(
        client,
        prompt,
        model,
        ANTHROPIC_EXTRACTION_TIMEOUT_MS,
      );
      console.log(
        `[llm:claude] Raw response (first 300 chars): ${raw.slice(0, 300)}`,
      );

      const deaths = parseDeathResponse(raw);
      console.log(`[llm:claude] Extracted ${deaths.length} deaths`);

      if (hasParsedDeaths && deaths.length < scraped.parsedDeaths.length * 0.8) {
        const llmNames = new Set(deaths.map((d) => d.character));
        const dropped = scraped.parsedDeaths
          .filter((d) => !llmNames.has(d.character))
          .map((d) => d.character);
        console.warn(
          `[llm:claude] Enrichment dropped deaths (${deaths.length} vs ${scraped.parsedDeaths.length} parsed) — using parsed deaths. Dropped: ${dropped.join(", ")}`,
        );
        return scraped.parsedDeaths;
      }

      return deaths;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isLast = attempt === ANTHROPIC_MAX_RETRIES - 1;

      if (isLast || !isRetryableError(error)) {
        if (isLast) {
          console.warn(
            `[llm:claude] All ${ANTHROPIC_MAX_RETRIES} attempts failed. Last error: ${msg}`,
          );
        } else {
          console.warn(
            `[llm:claude] Non-retryable error (${msg}) — not retrying`,
          );
        }

        if (hasParsedDeaths) {
          console.warn(
            `[llm:claude] Falling back to ${scraped.parsedDeaths.length} parsed deaths without enrichment`,
          );
          return scraped.parsedDeaths;
        }

        throw new Error(`LLM extraction failed after all attempts: ${msg}`);
      }

      const delay = ANTHROPIC_RETRY_DELAYS[attempt] ?? 32_000;
      console.warn(
        `[llm:claude] Attempt ${attempt + 1}/${ANTHROPIC_MAX_RETRIES} failed (${msg}), retrying in ${delay / 1000}s...`,
      );
      await sleep(delay);
    }
  }

  return hasParsedDeaths ? scraped.parsedDeaths : [];
}
