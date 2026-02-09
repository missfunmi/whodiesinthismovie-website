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
const LLM_TIMEOUT_MS = 30_000; // 30 seconds for death extraction
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
  const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2:3b";

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

  for (let attempt = 0; attempt < TMDB_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: tmdbApiKey,
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
    if (cert) mpaaRating = cert;
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

/**
 * Try to scrape death data from multiple web sources. Returns raw text content
 * suitable for LLM extraction, or empty string if all sources fail.
 */
async function scrapeDeathData(title: string, year: number): Promise<string> {
  // Source 1: List of Deaths fandom wiki
  const fandomContent = await scrapeFandomWiki(title, year);
  if (fandomContent) {
    console.log(
      `[worker:scrape] Found content on List of Deaths wiki (${fandomContent.length} chars)`,
    );
    return fandomContent;
  }

  // Source 2: Wikipedia plot summary
  const wikiContent = await scrapeWikipediaPlot(title);
  if (wikiContent) {
    console.log(
      `[worker:scrape] Found content on Wikipedia (${wikiContent.length} chars)`,
    );
    return wikiContent;
  }

  // Source 3: The Movie Spoiler
  const spoilerContent = await scrapeMovieSpoiler(title);
  if (spoilerContent) {
    console.log(
      `[worker:scrape] Found content on The Movie Spoiler (${spoilerContent.length} chars)`,
    );
    return spoilerContent;
  }

  console.log(`[worker:scrape] No death data found from any source for "${title}"`);
  return "";
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
        headers: { "User-Agent": "WDITMBot/1.0 (movie death data research)" },
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
async function scrapeWikipediaPlot(title: string): Promise<string | null> {
  // Try page titles: "Title (film)", "Title (year film)", "Title"
  const pageVariants = [
    `${title} (film)`,
    title,
  ];

  for (const pageTitle of pageVariants) {
    const url = `${WIKIPEDIA_API_BASE}?action=query&titles=${encodeURIComponent(pageTitle)}&prop=extracts&exsectionformat=plain&format=json`;
    console.log(`[worker:scrape] Trying Wikipedia API: page="${pageTitle}"`);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "WDITMBot/1.0 (movie death data research)" },
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
      const $ = cheerio.load(page.extract);

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
        return plotText.slice(0, 8000);
      }

      // Fallback: if no distinct "Plot" section, use the full extract
      const fullText = $("body").text().trim();
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
        headers: { "User-Agent": "WDITMBot/1.0 (movie death data research)" },
        redirect: "follow",
      });
      if (!response.ok) {
        console.log(`[worker:scrape] Movie Spoiler returned ${response.status}`);
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove non-content elements
      $("nav, header, footer, script, style, .sidebar, .comments").remove();

      // Try to find the main spoiler content area
      const content =
        $(".entry-content").length ? $(".entry-content").first() :
        $("article").length ? $("article").first() :
        $(".post-content").length ? $(".post-content").first() : null;

      if (!content) continue;

      // Extract paragraphs
      const paragraphs: string[] = [];
      content.find("p").each((_i, el) => {
        const text = $(el).text().trim();
        if (text.length > 20) paragraphs.push(text);
      });

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
 * Use Ollama to extract structured death data from scraped text content.
 * Returns an array of death records, or empty array if extraction fails.
 */
async function extractDeathsWithLlm(
  title: string,
  scrapedContent: string,
  ollamaEndpoint: string,
  ollamaModel: string,
): Promise<ExtractedDeath[]> {
  if (!scrapedContent || scrapedContent.trim().length === 0) {
    console.log(`[worker:llm] No content to extract deaths from — zero-death movie`);
    return [];
  }

  const prompt = `Extract character deaths from this text about the movie "${title}".
Return ONLY a valid JSON array of objects. Each object must have these exact fields:
- character (string): character name
- timeOfDeath (string): when they died
- cause (string): how they died
- killedBy (string): who killed them (use "N/A" if not applicable)
- context (string): 1-2 sentence summary
- isAmbiguous (boolean): true if death is unclear/off-screen

Example format:
[{"character":"John","timeOfDeath":"Act 3","cause":"Gunshot","killedBy":"Villain","context":"Shot during the final battle.","isAmbiguous":false}]

If no deaths, return: []
Return ONLY valid JSON. No other text.

Text:
${scrapedContent}`;

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      console.log(
        `[worker:llm] Calling Ollama (attempt ${attempt + 1}/${LLM_MAX_RETRIES}, model: ${ollamaModel})`,
      );

      const response = await fetch(`${ollamaEndpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          prompt,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const rawResponse = (data.response || "").trim();
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

      if (msg.includes("aborted") || msg.includes("abort")) {
        console.warn(`[worker:llm] Timeout after ${LLM_TIMEOUT_MS}ms (attempt ${attempt + 1})`);
      } else if (msg.includes("JSON")) {
        console.warn(`[worker:llm] Invalid JSON from LLM (attempt ${attempt + 1}): ${msg}`);
      } else {
        console.warn(`[worker:llm] Error (attempt ${attempt + 1}): ${msg}`);
      }

      if (attempt === LLM_MAX_RETRIES - 1) {
        throw new Error(`LLM extraction failed after ${LLM_MAX_RETRIES} attempts: ${msg}`);
      }

      // Brief wait before retry
      await sleep(2_000);
    } finally {
      clearTimeout(timeout);
    }
  }

  return []; // Should not reach here, but safe fallback
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

  // Step 1: Search TMDB for the movie
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

  // Step 2: Deduplication checks
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

  // Step 3: Fetch full metadata from TMDB (3 parallel requests)
  console.log(`[worker:tmdb] Fetching full metadata for tmdbId ${tmdbId}...`);
  const movieData = await fetchTmdbMetadata(tmdbId, config.tmdbApiKey);
  console.log(
    `[worker:tmdb] Metadata: "${movieData.title}" (${movieData.year}), director: ${movieData.director}, rating: ${movieData.mpaaRating}, runtime: ${movieData.runtime}min`,
  );

  // Rate limiting between TMDB and scraping
  await sleep(TMDB_RATE_LIMIT_MS);

  // Step 4: Scrape death data from web sources
  console.log(`[worker:scrape] Scraping death data for "${movieData.title}" (${movieData.year})...`);
  const scrapedContent = await scrapeDeathData(movieData.title, movieData.year);

  // Step 5: Extract structured deaths via LLM
  console.log(`[worker:llm] Extracting deaths from scraped content...`);
  const deaths = await extractDeathsWithLlm(
    movieData.title,
    scrapedContent,
    config.ollamaEndpoint,
    config.ollamaModel,
  );

  // Step 6: Insert into database
  console.log(`[worker:db] Inserting movie and ${deaths.length} deaths...`);

  // Upsert movie (by tmdbId unique constraint)
  const movie = await prisma.movie.upsert({
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
  await prisma.death.deleteMany({ where: { movieId: movie.id } });

  // Bulk insert new deaths
  if (deaths.length > 0) {
    await prisma.death.createMany({
      data: deaths.map((d) => ({
        movieId: movie.id,
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
  await prisma.ingestionQueue.update({
    where: { id: job.id },
    data: { status: "complete", completedAt: new Date(), tmdbId },
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
  console.log(`  TMDB API: configured`);
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
