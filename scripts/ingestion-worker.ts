/**
 * Ingestion Worker — Phase 5
 *
 * Background process that polls the IngestionQueue for pending movie requests,
 * fetches metadata from TMDB, scrapes death data from web sources, uses an LLM
 * to extract structured deaths, and inserts results into the database.
 *
 * Run: npm run worker
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Configuration & constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_RATE_LIMIT_MS = 500; // Delay between TMDB call batches
const TMDB_MAX_RETRIES = 3;
const TMDB_RETRY_DELAYS = [2_000, 4_000, 8_000]; // Exponential backoff
const LLM_INACTIVITY_TIMEOUT_MS = 30_000; // 30s with no new tokens → abort
const LLM_MAX_TOTAL_MS = 180_000; // 180s hard ceiling per attempt
const LLM_MAX_RETRIES = 3;

const FANDOM_API_BASE =
  "https://listofdeaths.fandom.com/api.php";
const WIKIPEDIA_API_BASE =
  "https://en.wikipedia.org/w/api.php";
const MOVIE_SPOILER_BASE = "https://themoviespoiler.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngestionJob {
  id: number;
  query: string;
  status: string;
  tmdbId: number | null;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

interface TmdbMovieData {
  id: number;
  title: string;
  release_date: string;
  tagline: string;
  poster_path: string | null;
  runtime: number;
}

interface TmdbCredits {
  crew: Array<{ job: string; name: string }>;
}

interface TmdbReleaseDates {
  results: Array<{
    iso_3166_1: string;
    release_dates: Array<{
      type: number;
      certification: string;
    }>;
  }>;
}

interface ExtractedDeath {
  character: string;
  timeOfDeath: string;
  cause: string;
  killedBy: string;
  context: string;
  isAmbiguous: boolean;
}

interface MovieRecord {
  tmdbId: number;
  title: string;
  year: number;
  director: string;
  tagline: string | null;
  posterPath: string | null;
  runtime: number;
  mpaaRating: string;
}

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

function validateEnv(): {
  databaseUrl: string;
  tmdbApiKey: string;
  ollamaEndpoint: string;
  ollamaModel: string;
} {
  const databaseUrl = process.env.DATABASE_URL;
  const tmdbApiKey = process.env.TMDB_API_KEY;
  const ollamaEndpoint =
    process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "mistral";

  if (!databaseUrl) {
    console.error("[worker] Missing DATABASE_URL environment variable");
    process.exit(1);
  }
  if (!tmdbApiKey) {
    console.error("[worker] Missing TMDB_API_KEY environment variable");
    process.exit(1);
  }

  return { databaseUrl, tmdbApiKey, ollamaEndpoint, ollamaModel };
}

// ---------------------------------------------------------------------------
// Prisma client (same pattern as prisma/seed.ts)
// ---------------------------------------------------------------------------

function createPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

// ---------------------------------------------------------------------------
// TMDB API helpers
// ---------------------------------------------------------------------------

/**
 * Make an authenticated request to the TMDB API with exponential backoff retry.
 */
async function tmdbFetch(
  path: string,
  tmdbApiKey: string,
): Promise<Response> {
  const url = `${TMDB_BASE_URL}${path}`;

  // Support both raw API key and "Bearer "-prefixed key from .env
  const authHeader = tmdbApiKey.startsWith("Bearer ")
    ? tmdbApiKey
    : `Bearer ${tmdbApiKey}`;

  for (let attempt = 0; attempt < TMDB_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      });

      if (response.ok) return response;

      // Rate limited (429) or server error (5xx) — retry
      if (response.status === 429 || response.status >= 500) {
        const delay = TMDB_RETRY_DELAYS[attempt] ?? 8_000;
        console.warn(
          `[worker:tmdb] HTTP ${response.status} for ${path}, retrying in ${delay}ms (attempt ${attempt + 1}/${TMDB_MAX_RETRIES})`,
        );
        await sleep(delay);
        continue;
      }

      // Client error (4xx, not 429) — don't retry
      throw new Error(`TMDB API ${response.status}: ${response.statusText} for ${path}`);
    } catch (error) {
      if (error instanceof TypeError && attempt < TMDB_MAX_RETRIES - 1) {
        // Network error — retry
        const delay = TMDB_RETRY_DELAYS[attempt] ?? 8_000;
        console.warn(
          `[worker:tmdb] Network error for ${path}, retrying in ${delay}ms (attempt ${attempt + 1}/${TMDB_MAX_RETRIES})`,
        );
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`TMDB API failed after ${TMDB_MAX_RETRIES} attempts for ${path}`);
}

/**
 * Search TMDB for a movie by title. Returns the first result's tmdbId, or null.
 */
async function searchTmdb(
  query: string,
  tmdbApiKey: string,
): Promise<{ tmdbId: number; title: string } | null> {
  const path = `/search/movie?query=${encodeURIComponent(query)}&language=en-US`;
  const response = await tmdbFetch(path, tmdbApiKey);
  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    return null;
  }

  const first = data.results[0];
  if (data.results.length > 1) {
    console.log(
      `[worker:tmdb] Multiple matches for "${query}", using first: "${first.title}" (${first.id}). Others: ${data.results.slice(1, 4).map((r: { title: string; id: number }) => `"${r.title}" (${r.id})`).join(", ")}`,
    );
  }

  return { tmdbId: first.id, title: first.title };
}

/**
 * Fetch full movie metadata from TMDB (3 parallel requests).
 */
async function fetchTmdbMetadata(
  tmdbId: number,
  tmdbApiKey: string,
): Promise<MovieRecord> {
  const [movieRes, creditsRes, releasesRes] = await Promise.all([
    tmdbFetch(`/movie/${tmdbId}`, tmdbApiKey),
    tmdbFetch(`/movie/${tmdbId}/credits`, tmdbApiKey),
    tmdbFetch(`/movie/${tmdbId}/release_dates`, tmdbApiKey),
  ]);

  const movie: TmdbMovieData = await movieRes.json();
  const credits: TmdbCredits = await creditsRes.json();
  const releases: TmdbReleaseDates = await releasesRes.json();

  // Extract director(s)
  const directors = (credits.crew || [])
    .filter((c) => c.job === "Director")
    .map((c) => c.name);
  const director = directors.length > 0 ? directors.join(", ") : "Unknown";

  // Extract MPAA rating from US theatrical release
  const usRelease = (releases.results || []).find(
    (r) => r.iso_3166_1 === "US",
  );
  let mpaaRating = "NR";
  if (usRelease) {
    // Type 3 = theatrical release
    const theatrical = usRelease.release_dates.find((rd) => rd.type === 3);
    const fallback = usRelease.release_dates[0];
    const cert = theatrical?.certification || fallback?.certification;
    // TMDB returns empty string or "0" for unrated content — treat as NR
    if (cert && cert !== "0") mpaaRating = cert;
  }

  // Extract year from release_date
  const year = movie.release_date
    ? new Date(movie.release_date).getFullYear()
    : 0;

  return {
    tmdbId: movie.id,
    title: movie.title,
    year,
    director,
    tagline: movie.tagline || null,
    posterPath: movie.poster_path || null,
    runtime: movie.runtime || 0,
    mpaaRating,
  };
}

// ---------------------------------------------------------------------------
// Death data scraping
// ---------------------------------------------------------------------------

/** Scraped content from multiple sources, used together for best extraction */
interface ScrapedDeathData {
  /** Pre-parsed deaths from the Fandom wiki (programmatic, reliable) */
  parsedDeaths: ExtractedDeath[];
  /** Raw wikitext from Fandom (for LLM if needed) */
  fandomContent: string;
  /** Plot summary from Wikipedia or Movie Spoiler (for context enrichment) */
  plotSummary: string;
}

/**
 * Scrape death data from multiple web sources.
 * Strategy: parse the Fandom wiki programmatically for the death list (reliable),
 * then also fetch Wikipedia's plot summary for narrative context.
 * Both are passed to the LLM for enrichment.
 */
async function scrapeDeathData(title: string, year: number): Promise<ScrapedDeathData> {
  // Source 1: List of Deaths fandom wiki (primary — structured death list)
  const fandomContent = await scrapeFandomWiki(title, year);
  let parsedDeaths: ExtractedDeath[] = [];

  if (fandomContent) {
    console.log(
      `[worker:scrape] Found content on List of Deaths wiki (${fandomContent.length} chars)`,
    );
    // Parse the structured wikitext to reliably extract ALL deaths
    parsedDeaths = parseFandomDeaths(fandomContent);
    console.log(
      `[worker:scrape] Parsed ${parsedDeaths.length} deaths from wikitext`,
    );
  }

  // Source 2: Wikipedia plot summary (supplementary — narrative context)
  const wikiContent = await scrapeWikipediaPlot(title, year);
  if (wikiContent) {
    console.log(
      `[worker:scrape] Found Wikipedia plot summary (${wikiContent.length} chars)`,
    );
  }

  // Source 3: The Movie Spoiler (fallback for plot summary)
  let spoilerContent: string | null = null;
  if (!wikiContent) {
    spoilerContent = await scrapeMovieSpoiler(title);
    if (spoilerContent) {
      console.log(
        `[worker:scrape] Found Movie Spoiler content (${spoilerContent.length} chars)`,
      );
    }
  }

  const plotSummary = wikiContent || spoilerContent || "";

  if (!fandomContent && !plotSummary) {
    console.log(`[worker:scrape] No death data found from any source for "${title}"`);
  }

  return {
    parsedDeaths,
    fandomContent: fandomContent || "",
    plotSummary,
  };
}

/**
 * Parse the Fandom wiki's Victims section wikitext into structured death records.
 * The wikitext follows a bullet-list format:
 *   * Character Name - Description of death
 *   * <u>''Character''</u> - Description
 *
 * This is far more reliable than LLM extraction for getting the complete death list.
 */
function parseFandomDeaths(wikitext: string): ExtractedDeath[] {
  const deaths: ExtractedDeath[] = [];

  const allLines = wikitext.split("\n");

  for (let i = 0; i < allLines.length; i++) {
    const rawLine = allLines[i];
    // Only process top-level bullets (single *)
    if (!rawLine.trim().startsWith("*") || rawLine.trim().startsWith("**")) continue;

    // Strip leading "* " and wiki markup
    let line = rawLine.replace(/^\*+\s*/, "");
    // Strip wiki formatting: bold ''', italic '', underline <u></u>, links [[]]
    line = line
      .replace(/<\/?u>/gi, "")
      .replace(/'{2,3}/g, "")
      .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, _link, display) => display || _link)
      .replace(/<[^>]+>/g, "")
      .trim();

    if (!line || line.length < 5) continue;

    // Split on " - " to get character name and death description
    const dashIndex = line.indexOf(" - ");
    if (dashIndex === -1) continue;

    const character = line.slice(0, dashIndex).trim();
    const description = line.slice(dashIndex + 3).trim();

    if (!character || !description) continue;

    // Collect sub-bullet context (** lines following this entry)
    const subBulletParts: string[] = [];
    for (let j = i + 1; j < allLines.length; j++) {
      const nextLine = allLines[j].trim();
      if (nextLine.startsWith("**")) {
        let sub = nextLine.replace(/^\*+\s*/, "");
        sub = sub
          .replace(/<\/?u>/gi, "")
          .replace(/'{2,3}/g, "")
          .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, _link, display) => display || _link)
          .replace(/<[^>]+>/g, "")
          .trim();
        if (sub) subBulletParts.push(sub);
      } else {
        break; // Stop at next top-level bullet or non-bullet line
      }
    }
    const subContext = subBulletParts.join("; ");

    // Determine if death is ambiguous (off-screen, mentioned, uncertain)
    const lowerDesc = description.toLowerCase();
    const isAmbiguous =
      lowerDesc.includes("off-screen") ||
      lowerDesc.includes("mentioned") ||
      lowerDesc.includes("uncertain") ||
      lowerDesc.includes("debatable") ||
      lowerDesc.includes("unknown if");

    // Try to extract "killed by" from description
    // Handles: "eaten by X", "shot by X", "bitten in half by X", "at the hands of X"
    let killedBy = "N/A";
    const killedByMatch = description.match(
      /(?:killed|eaten|shot|stabbed|murdered|bitten|dragged|torn apart|blown up|attacked|beheaded|strangled|crushed|drowned|poisoned|mauled|devoured|impaled|decapitated)\b.*?\b(?:by|at the hands of)\s+([^,.;(]+)/i,
    );
    if (killedByMatch) {
      killedBy = killedByMatch[1].trim();
      // Clean up trailing noise
      killedBy = killedBy
        .replace(/\s+off-screen.*$/i, "")
        .replace(/\s+with\s+.+$/i, "") // "Martin Brody with a rifle" → "Martin Brody"
        .replace(/\s+in\s+\d{4}.*$/i, "") // "sharks in 1916" → "sharks"
        .trim();
    }

    deaths.push({
      character,
      timeOfDeath: "Unknown",
      cause: description,
      killedBy,
      context: subContext,
      isAmbiguous,
    });
  }

  return deaths;
}

/**
 * Scrape the List of Deaths fandom wiki using the MediaWiki API.
 * Returns raw wikitext containing death entries (structured as bullet lists).
 */
async function scrapeFandomWiki(title: string, year?: number): Promise<string | null> {
  // Try year-specific page first (e.g., "Jaws (1975)"), then plain title, then (film)
  const pageVariants = [
    ...(year ? [`${title} (${year})`] : []),
    title,
    `${title} (film)`,
  ];

  for (const pageTitle of pageVariants) {
    const url = `${FANDOM_API_BASE}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json`;
    console.log(`[worker:scrape] Trying List of Deaths wiki API: page="${pageTitle}"`);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "WDITMBot/1.0 (contact@whodiesinthismovie.com; movie death data research)" },
      });
      if (!response.ok) {
        console.log(`[worker:scrape] Fandom API returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      if (data.error) {
        console.log(`[worker:scrape] Fandom API error: ${data.error.info || data.error.code}`);
        continue;
      }

      const wikitext: string = data.parse?.wikitext?.["*"] || "";
      if (!wikitext || wikitext.length < 50) continue;

      // Extract the "Victims" section (primary death data) from wikitext
      const victimsMatch = wikitext.match(/==\s*Victims?\s*==\s*\n([\s\S]*?)(?:\n==\s*[^=]|$)/i);
      if (victimsMatch) {
        const content = victimsMatch[1].trim();
        if (content.length > 20) {
          return content.slice(0, 8000);
        }
      }

      // Fallback: return the whole wikitext if it contains death-related content
      if (wikitext.toLowerCase().includes("killed") || wikitext.toLowerCase().includes("death")) {
        return wikitext.slice(0, 8000);
      }
    } catch (error) {
      console.log(`[worker:scrape] Fandom API error: ${error instanceof Error ? error.message : error}`);
    }
  }

  return null;
}

/**
 * Scrape Wikipedia for the movie's plot summary using the MediaWiki API.
 * The plot section typically describes deaths in narrative form.
 */
async function scrapeWikipediaPlot(title: string, year?: number): Promise<string | null> {
  // Try page titles in order of specificity
  const pageVariants = [
    ...(year ? [`${title} (${year} film)`] : []),
    `${title} (film)`,
    title,
  ];

  for (const pageTitle of pageVariants) {
    const url = `${WIKIPEDIA_API_BASE}?action=query&titles=${encodeURIComponent(pageTitle)}&prop=extracts&exsectionformat=plain&format=json`;
    console.log(`[worker:scrape] Trying Wikipedia API: page="${pageTitle}"`);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "WDITMBot/1.0 (contact@whodiesinthismovie.com; movie death data research)" },
      });
      if (!response.ok) {
        console.log(`[worker:scrape] Wikipedia API returned ${response.status}`);
        continue;
      }

      const data = await response.json();
      const pages = data.query?.pages || {};
      const page = Object.values(pages)[0] as { extract?: string; missing?: boolean };

      if (!page || page.missing || !page.extract) {
        console.log(`[worker:scrape] Wikipedia page not found: "${pageTitle}"`);
        continue;
      }

      // The extract is HTML — parse with cheerio to find the Plot section
      // Truncate early to cap memory usage in this long-running process
      const extractHtml = (page.extract as string).slice(0, 100_000);
      let $ = cheerio.load(extractHtml);

      let plotText = "";
      let inPlotSection = false;

      // Wikipedia API extracts use <h2>, <h3> as section headers
      $("body").children().each((_i, el) => {
        const tagName = (el as cheerio.Element).tagName?.toLowerCase();
        const text = $(el).text().trim();

        if (tagName === "h2" || tagName === "h3") {
          if (text.toLowerCase().includes("plot")) {
            inPlotSection = true;
            return; // continue
          }
          if (inPlotSection) {
            return false; // break — next section
          }
        }

        if (inPlotSection && tagName === "p") {
          plotText += text + "\n\n";
        }
      });

      if (plotText.length > 100) {
        ($ as unknown) = null; // Release cheerio DOM for GC
        return plotText.slice(0, 8000);
      }

      // Fallback: if no distinct "Plot" section, use the full extract
      const fullText = $("body").text().trim();
      ($ as unknown) = null; // Release cheerio DOM for GC
      if (fullText.length > 200) {
        console.log(`[worker:scrape] Wikipedia: no Plot section, using full extract`);
        return fullText.slice(0, 8000);
      }
    } catch (error) {
      console.log(`[worker:scrape] Wikipedia API error: ${error instanceof Error ? error.message : error}`);
    }
  }

  return null;
}

/**
 * Scrape The Movie Spoiler for death-related content.
 * Uses Google-style search to find the right page since URL patterns vary.
 */
async function scrapeMovieSpoiler(title: string): Promise<string | null> {
  // The Movie Spoiler uses various URL patterns; try direct URL first
  const slugVariants = [
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""),
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "") + "-the",
    "the-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""),
  ];

  for (const slug of slugVariants) {
    const url = `${MOVIE_SPOILER_BASE}/${slug}`;
    console.log(`[worker:scrape] Trying The Movie Spoiler: ${url}`);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "WDITMBot/1.0 (contact@whodiesinthismovie.com; movie death data research)" },
        redirect: "follow",
      });
      if (!response.ok) {
        console.log(`[worker:scrape] Movie Spoiler returned ${response.status}`);
        continue;
      }

      // Truncate HTML early to cap memory in this long-running process
      const html = (await response.text()).slice(0, 500_000);
      let $ = cheerio.load(html);

      // Remove non-content elements
      $("nav, header, footer, script, style, .sidebar, .comments").remove();

      // Try to find the main spoiler content area
      const content =
        $(".entry-content").length ? $(".entry-content").first() :
        $("article").length ? $("article").first() :
        $(".post-content").length ? $(".post-content").first() : null;

      if (!content) {
        ($ as unknown) = null;
        continue;
      }

      // Extract paragraphs
      const paragraphs: string[] = [];
      content.find("p").each((_i, el) => {
        const text = $(el).text().trim();
        if (text.length > 20) paragraphs.push(text);
      });

      ($ as unknown) = null; // Release cheerio DOM for GC

      if (paragraphs.length === 0) continue;

      const combined = paragraphs.join("\n\n");
      return combined.slice(0, 8000);
    } catch (error) {
      console.log(`[worker:scrape] Movie Spoiler error: ${error instanceof Error ? error.message : error}`);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// LLM death extraction via Ollama
// ---------------------------------------------------------------------------

/**
 * Attempt to repair common JSON formatting errors from LLM output.
 * Handles cases like: `["key": "value"]` → `[{"key": "value"}]`
 * and missing commas between array elements.
 */
function repairLlmJson(json: string): string {
  let repaired = json.trim();

  // Fix LLM using [] instead of {} for objects:
  // Pattern: `["key":` should be `[{"key":` (start of array with first object)
  // Pattern: `],\n["key":` should be `},{"key":` (between objects)
  // Pattern: `"value"]` at end should be `"value"}]`
  if (repaired.startsWith("[") && repaired.includes('"character"')) {
    // Check if it's actually malformed (array of key:value pairs instead of objects)
    try {
      JSON.parse(repaired);
      return repaired; // Already valid, don't touch
    } catch {
      // Try to fix by converting [key:val],\n[key:val] → [{key:val},{key:val}]
      repaired = repaired
        // Replace `],\n[` between entries with `},{`
        .replace(/\]\s*,?\s*\n\s*\[/g, "},{")
        // Replace leading `["` with `[{"` if it looks like an object
        .replace(/^\[\s*"(?=\w+"\s*:)/, '[{"')
        // Replace trailing `]` with `}]` for the last entry
        .replace(/"\s*\]$/, '"}]')
        // Handle boolean/number values at end: `false]` → `false}]`, `true]` → `true}]`
        .replace(/(true|false|\d+)\s*\]$/, "$1}]");
    }
  }

  return repaired;
}

/**
 * Call Ollama with streaming enabled.
 * Uses an inactivity timeout (no new tokens for N seconds) rather than a fixed
 * total timeout. This handles cold model loading gracefully — the model may
 * take 30-60s to load into VRAM, then stream tokens steadily.
 */
async function callOllamaStreaming(
  ollamaEndpoint: string,
  ollamaModel: string,
  prompt: string,
): Promise<string> {
  const controller = new AbortController();
  const startTime = Date.now();

  // Hard ceiling: abort no matter what after LLM_MAX_TOTAL_MS
  const totalTimeout = setTimeout(() => controller.abort(), LLM_MAX_TOTAL_MS);

  // Inactivity timer: reset every time we receive a chunk
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), LLM_INACTIVITY_TIMEOUT_MS);
  };

  try {
    resetInactivityTimer();

    const response = await fetch(`${ollamaEndpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: true,
        options: {
          // Explicitly set context window. Many models default to 2048 tokens
          // which is too small for enrichment prompts (death list + plot summary).
          num_ctx: 8192,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("Ollama response has no body (streaming not supported?)");
    }

    let accumulated = "";
    const decoder = new TextDecoder();

    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      resetInactivityTimer();
      const text = decoder.decode(chunk, { stream: true });

      // Ollama streams NDJSON: one JSON object per line
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            accumulated += parsed.response;
          }
          if (parsed.done) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[worker:llm] Streaming complete in ${elapsed}s (${accumulated.length} chars)`);
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

/**
 * Use Ollama to extract/enrich structured death data.
 *
 * Two modes:
 * 1. Enrichment (preferred): We already have parsed deaths from the wiki.
 *    The LLM adds timeOfDeath, context, and validates killedBy using the plot summary.
 * 2. Full extraction (fallback): No parsed deaths available. The LLM extracts
 *    everything from the raw text (Wikipedia plot or Movie Spoiler content).
 */
async function extractDeathsWithLlm(
  title: string,
  scraped: ScrapedDeathData,
  ollamaEndpoint: string,
  ollamaModel: string,
): Promise<ExtractedDeath[]> {
  const hasPlot = scraped.plotSummary.trim().length > 0;
  const hasParsedDeaths = scraped.parsedDeaths.length > 0;
  const hasAnyContent = scraped.fandomContent.length > 0 || hasPlot;

  if (!hasAnyContent && !hasParsedDeaths) {
    console.log(`[worker:llm] No content to extract deaths from — zero-death movie`);
    return [];
  }

  // If we have parsed deaths but no plot summary, use them as-is (no LLM needed)
  if (hasParsedDeaths && !hasPlot) {
    console.log(
      `[worker:llm] Using ${scraped.parsedDeaths.length} parsed deaths (no plot summary available for enrichment)`,
    );
    return scraped.parsedDeaths;
  }

  let prompt: string;

  if (hasParsedDeaths && hasPlot) {
    // Enrichment mode: we have the death list, LLM fills in context from plot
    const deathSummary = scraped.parsedDeaths
      .map((d, i) => `${i + 1}. ${d.character} — ${d.cause}`)
      .join("\n");

    prompt = `Here are the character deaths from the movie "${title}":

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
  } else {
    // Full extraction mode: no parsed deaths, extract from plot/raw content
    const content = scraped.plotSummary || scraped.fandomContent;
    prompt = `Extract ALL character deaths from this text about the movie "${title}".
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

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[worker:llm] Calling Ollama (attempt ${attempt + 1}/${LLM_MAX_RETRIES}, model: ${ollamaModel})`,
      );

      const rawResponse = await callOllamaStreaming(ollamaEndpoint, ollamaModel, prompt);
      console.log(
        `[worker:llm] Raw response (first 300 chars): ${rawResponse.slice(0, 300)}`,
      );

      // Strip markdown code fences if present
      let cleaned = rawResponse
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      // Try to extract JSON array from the response if it's wrapped in other text
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        cleaned = arrayMatch[0];
      }

      // Attempt JSON repair for common LLM mistakes
      cleaned = repairLlmJson(cleaned);

      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) {
        throw new Error("LLM response is not a JSON array");
      }

      // Validate and normalize each death record
      const deaths: ExtractedDeath[] = parsed.map((d: Record<string, unknown>) =>
        validateDeathRecord(d),
      );

      console.log(`[worker:llm] Extracted ${deaths.length} deaths`);
      return deaths;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes("aborted") || msg.includes("abort") || msg.includes("inactivity")) {
        console.warn(`[worker:llm] Timeout (attempt ${attempt + 1}): ${msg}`);
      } else if (msg.includes("JSON")) {
        console.warn(`[worker:llm] Invalid JSON from LLM (attempt ${attempt + 1}): ${msg}`);
      } else {
        console.warn(`[worker:llm] Error (attempt ${attempt + 1}): ${msg}`);
      }

      if (attempt === LLM_MAX_RETRIES - 1) {
        // Fall back to parsed deaths if available (better than failing entirely)
        if (hasParsedDeaths) {
          console.warn(
            `[worker:llm] LLM failed, falling back to ${scraped.parsedDeaths.length} parsed deaths without enrichment`,
          );
          return scraped.parsedDeaths;
        }
        throw new Error(`LLM extraction failed after ${LLM_MAX_RETRIES} attempts: ${msg}`);
      }

      // Brief wait before retry
      await sleep(2_000);
    }
  }

  return hasParsedDeaths ? scraped.parsedDeaths : []; // Safe fallback
}

/**
 * Decode common HTML entities that LLMs sometimes produce in JSON output.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Validate and normalize a death record from LLM output.
 */
function validateDeathRecord(d: Record<string, unknown>): ExtractedDeath {
  return {
    character: decodeHtmlEntities(String(d.character || "Unknown")),
    timeOfDeath: decodeHtmlEntities(String(d.timeOfDeath || "Unknown")),
    cause: decodeHtmlEntities(String(d.cause || "Unknown")),
    killedBy: d.killedBy && String(d.killedBy).trim() ? decodeHtmlEntities(String(d.killedBy)) : "N/A",
    context: decodeHtmlEntities(String(d.context || "")),
    isAmbiguous: Boolean(d.isAmbiguous),
  };
}

// ---------------------------------------------------------------------------
// LLM movie title validation (best-effort, per SPEC architecture diagram)
// ---------------------------------------------------------------------------

const LLM_VALIDATION_TIMEOUT_MS = 5_000; // Short timeout — validation is best-effort

/**
 * Ask the LLM whether the query is a real movie title.
 * Returns true if valid or if Ollama is unavailable (best-effort — don't block ingestion).
 */
async function validateMovieTitleWithLlm(
  query: string,
  ollamaEndpoint: string,
  ollamaModel: string,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetch(`${ollamaEndpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: `Is '${query}' a real movie title? Answer with only YES or NO.`,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.log(`[worker:llm] Validation: Ollama returned ${response.status}, skipping`);
      return true; // Best-effort — proceed if Ollama errors
    }

    const data = await response.json();
    const answer = ((data.response as string) || "").trim().toUpperCase();
    const isRealMovie = answer.startsWith("YES");
    console.log(`[worker:llm] Validation for "${query}": ${answer} (isRealMovie: ${isRealMovie})`);
    return isRealMovie;
  } catch {
    // Ollama unavailable, timeout, or parse error — skip validation
    console.log("[worker:llm] Validation skipped (Ollama unavailable or timeout)");
    return true; // Best-effort — proceed if Ollama is down
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Job processing pipeline
// ---------------------------------------------------------------------------

/**
 * Process a single ingestion job end-to-end.
 */
async function processJob(
  job: IngestionJob,
  prisma: PrismaClient,
  config: { tmdbApiKey: string; ollamaEndpoint: string; ollamaModel: string },
): Promise<void> {
  console.log(`[worker] Processing job #${job.id}: "${job.query}"`);

  // Step 1: LLM validation (best-effort — if Ollama is down, proceed anyway)
  const isValidTitle = await validateMovieTitleWithLlm(
    job.query,
    config.ollamaEndpoint,
    config.ollamaModel,
  );
  if (!isValidTitle) {
    throw new Error("LLM validation: not a real movie title");
  }

  // Step 2: Search TMDB for the movie
  console.log(`[worker:tmdb] Searching for "${job.query}"...`);
  const searchResult = await searchTmdb(job.query, config.tmdbApiKey);

  if (!searchResult) {
    throw new Error("Not found in TMDB");
  }

  const { tmdbId } = searchResult;
  console.log(
    `[worker:tmdb] Found: "${searchResult.title}" (tmdbId: ${tmdbId})`,
  );

  // Store tmdbId in the queue record
  await prisma.ingestionQueue.update({
    where: { id: job.id },
    data: { tmdbId },
  });

  // Step 3: Deduplication checks
  // Check if another job is already processing this tmdbId
  const duplicateJob = await prisma.ingestionQueue.findFirst({
    where: {
      tmdbId,
      status: "processing",
      id: { not: job.id },
    },
  });

  if (duplicateJob) {
    console.log(
      `[worker] Duplicate detected: job #${duplicateJob.id} is already processing tmdbId ${tmdbId}`,
    );
    await prisma.ingestionQueue.update({
      where: { id: job.id },
      data: { status: "complete", completedAt: new Date() },
    });
    return;
  }

  // Check if movie already exists in the database
  const existingMovie = await prisma.movie.findUnique({
    where: { tmdbId },
  });

  if (existingMovie) {
    console.log(
      `[worker] Movie already in database: "${existingMovie.title}" (id: ${existingMovie.id})`,
    );
    await prisma.ingestionQueue.update({
      where: { id: job.id },
      data: { status: "complete", completedAt: new Date() },
    });
    return;
  }

  // Step 4: Fetch full metadata from TMDB (3 parallel requests)
  console.log(`[worker:tmdb] Fetching full metadata for tmdbId ${tmdbId}...`);
  const movieData = await fetchTmdbMetadata(tmdbId, config.tmdbApiKey);
  console.log(
    `[worker:tmdb] Metadata: "${movieData.title}" (${movieData.year}), director: ${movieData.director}, rating: ${movieData.mpaaRating}, runtime: ${movieData.runtime}min`,
  );

  // Rate limiting between TMDB and scraping
  await sleep(TMDB_RATE_LIMIT_MS);

  // Step 5: Scrape death data from web sources (Fandom wiki + Wikipedia plot)
  console.log(`[worker:scrape] Scraping death data for "${movieData.title}" (${movieData.year})...`);
  const scraped = await scrapeDeathData(movieData.title, movieData.year);

  // Step 6: Extract/enrich structured deaths via LLM
  console.log(`[worker:llm] Extracting deaths from scraped content...`);
  const deaths = await extractDeathsWithLlm(
    movieData.title,
    scraped,
    config.ollamaEndpoint,
    config.ollamaModel,
  );

  // Step 7: Insert into database (atomic transaction)
  // Wrapping upsert + delete + insert + queue update in a transaction ensures
  // the movie is never left with zero deaths if the process crashes mid-write.
  console.log(`[worker:db] Inserting movie and ${deaths.length} deaths...`);

  const movie = await prisma.$transaction(async (tx) => {
    // Upsert movie (by tmdbId unique constraint)
    const m = await tx.movie.upsert({
      where: { tmdbId: movieData.tmdbId },
      create: {
        tmdbId: movieData.tmdbId,
        title: movieData.title,
        year: movieData.year,
        director: movieData.director,
        tagline: movieData.tagline,
        posterPath: movieData.posterPath,
        runtime: movieData.runtime,
        mpaaRating: movieData.mpaaRating,
      },
      update: {
        title: movieData.title,
        year: movieData.year,
        director: movieData.director,
        tagline: movieData.tagline,
        posterPath: movieData.posterPath,
        runtime: movieData.runtime,
        mpaaRating: movieData.mpaaRating,
      },
    });

    // Delete existing deaths for this movie (replace strategy)
    await tx.death.deleteMany({ where: { movieId: m.id } });

    // Bulk insert new deaths
    if (deaths.length > 0) {
      await tx.death.createMany({
        data: deaths.map((d) => ({
          movieId: m.id,
          character: d.character,
          timeOfDeath: d.timeOfDeath,
          cause: d.cause,
          killedBy: d.killedBy,
          context: d.context,
          isAmbiguous: d.isAmbiguous,
        })),
      });
    }

    // Update queue entry to complete
    await tx.ingestionQueue.update({
      where: { id: job.id },
      data: { status: "complete", completedAt: new Date(), tmdbId },
    });

    return m;
  });

  console.log(
    `[worker:db] Successfully inserted "${movieData.title}" (movie.id=${movie.id}) with ${deaths.length} deaths`,
  );
}

// ---------------------------------------------------------------------------
// Queue polling
// ---------------------------------------------------------------------------

/**
 * Poll the queue for one pending job and process it.
 */
async function processQueue(
  prisma: PrismaClient,
  config: { tmdbApiKey: string; ollamaEndpoint: string; ollamaModel: string },
): Promise<void> {
  // Pick the oldest pending job
  const job = await prisma.ingestionQueue.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) return; // No pending jobs — silent return

  // Mark as processing immediately (prevents duplicate pickup)
  await prisma.ingestionQueue.update({
    where: { id: job.id },
    data: { status: "processing" },
  });

  try {
    await processJob(job, prisma, config);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[worker] Job #${job.id} failed: ${reason}`);

    await prisma.ingestionQueue.update({
      where: { id: job.id },
      data: { status: "failed", failureReason: reason.slice(0, 500) },
    });
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = validateEnv();
  const prisma = createPrisma(config.databaseUrl);

  console.log("[worker] Ingestion worker starting...");
  console.log(`[worker] Config:`);
  console.log(`  Database: ${config.databaseUrl.replace(/:[^@]+@/, ":***@")}`);
  console.log(`  TMDB API: configured (${config.tmdbApiKey.startsWith("Bearer ") ? "Bearer token" : "raw key, will add Bearer prefix"})`);
  console.log(`  Ollama: ${config.ollamaEndpoint} (model: ${config.ollamaModel})`);
  console.log(`  Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log("[worker] Polling for jobs...\n");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[worker] Received ${signal}, shutting down...`);
    await prisma.$disconnect();
    console.log("[worker] Disconnected from database. Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Main polling loop
  while (true) {
    try {
      await processQueue(prisma, config);
    } catch (error) {
      // Unexpected error in the queue processor itself — log and continue
      console.error(
        `[worker] Unexpected error in queue processor:`,
        error instanceof Error ? error.message : error,
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
