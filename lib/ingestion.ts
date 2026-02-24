/**
 * Shared ingestion processing logic.
 *
 * Used by:
 *   - app/api/cron/process-queue/route.ts (Vercel Cron — production)
 *   - scripts/ingestion-worker.ts (local development polling worker)
 *
 * Handles: TMDB metadata fetching, multi-source death scraping,
 * LLM-based death extraction, and atomic database insertion.
 */

import * as cheerio from "cheerio";
import type { PrismaClient } from "../app/generated/prisma/client";
import {
  extractDeaths,
  validateMovieTitle,
  type LlmConfig,
  type ExtractedDeath,
} from "./llm";
import { parseQueryWithYear } from "./utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_RATE_LIMIT_MS = 500; // Delay between TMDB call batches
const TMDB_MAX_RETRIES = 3;
const TMDB_RETRY_DELAYS = [2_000, 4_000, 8_000]; // Exponential backoff

const FANDOM_API_BASE = "https://listofdeaths.fandom.com/api.php";
const WIKIPEDIA_API_BASE = "https://en.wikipedia.org/w/api.php";
const MOVIE_SPOILER_BASE = "https://themoviespoiler.com/movies";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestionJob {
  id: number;
  query: string;
  year: number | null;
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

/** Result from a single scraping source — includes both section content and full page text */
interface ScrapedResult {
  /** Extracted section content (Victims, Plot, etc.) used for death parsing */
  content: string;
  /** Full page text used for disambiguation validation (contains year, director, etc.) */
  fullText: string;
}

/** Scraped content from multiple sources, used together for best extraction */
interface ScrapedDeathData {
  /** Pre-parsed deaths from the Fandom wiki (programmatic, reliable) */
  parsedDeaths: ExtractedDeath[];
  /** Raw wikitext from Fandom (for LLM if needed) */
  fandomContent: string;
  /** Plot summary from Wikipedia or Movie Spoiler (for context enrichment) */
  plotSummary: string;
}

export interface ProcessJobConfig {
  tmdbApiKey: string;
  llmConfig: LlmConfig;
}

/** Result returned by processQueue — describes what happened during queue processing */
export type QueueResult =
  | { processed: false; reason: "no_jobs" }
  | { processed: true; jobId: number; title: string }
  | { processed: true; jobId: number; failed: true; reason: string };

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
          `[ingestion:tmdb] HTTP ${response.status} for ${path}, retrying in ${delay}ms (attempt ${attempt + 1}/${TMDB_MAX_RETRIES})`,
        );
        await sleep(delay);
        continue;
      }

      // Client error (4xx, not 429) — don't retry
      throw new Error(
        `TMDB API ${response.status}: ${response.statusText} for ${path}`,
      );
    } catch (error) {
      if (error instanceof TypeError && attempt < TMDB_MAX_RETRIES - 1) {
        // Network error — retry
        const delay = TMDB_RETRY_DELAYS[attempt] ?? 8_000;
        console.warn(
          `[ingestion:tmdb] Network error for ${path}, retrying in ${delay}ms (attempt ${attempt + 1}/${TMDB_MAX_RETRIES})`,
        );
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `TMDB API failed after ${TMDB_MAX_RETRIES} attempts for ${path}`,
  );
}

/**
 * Search TMDB for a movie by title. Returns the first result's tmdbId, or null.
 */
async function searchTmdb(
  query: string,
  tmdbApiKey: string,
  year?: number | null,
): Promise<{ tmdbId: number; title: string } | null> {
  let path = `/search/movie?query=${encodeURIComponent(query)}&language=en-US`;
  if (year) path += `&year=${year}`;
  const response = await tmdbFetch(path, tmdbApiKey);
  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    return null;
  }

  const first = data.results[0];
  if (data.results.length > 1) {
    console.log(
      `[ingestion:tmdb] Multiple matches for "${query}", using first: "${first.title}" (${first.id}). Others: ${data.results
        .slice(1, 4)
        .map((r: { title: string; id: number }) => `"${r.title}" (${r.id})`)
        .join(", ")}`,
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

/**
 * Validate that scraped content actually describes the correct movie.
 * Checks if the HEADER (first ~2500 chars) mentions the expected year OR director.
 * Restricting to the header prevents false positives from remake/sequel pages that
 * mention the original version's year or director in "Production" or "Legacy" sections.
 * Returns true if EITHER matches (permissive — avoids false rejections).
 */
function validateScrapedContent(
  content: string,
  year: number,
  director: string,
): boolean {
  if (!content || content.length < 50) return false;

  // Focus on the introduction/header for disambiguation — the correct year and
  // director are virtually always mentioned in the first ~2500 chars, while
  // references to other versions (remakes, originals) appear later.
  const headerContext = content.toLowerCase().slice(0, 2500);

  const hasYear = headerContext.includes(String(year));

  const directors = director.split(",").map((d) => d.trim().toLowerCase());
  const hasDirector = directors.some((d) => {
    if (d === "unknown") return false;
    const parts = d.split(/\s+/);
    const lastName = parts[parts.length - 1];
    // Match full name first, then last name only if >3 chars to avoid false matches
    return (
      headerContext.includes(d) ||
      (lastName.length > 3 && headerContext.includes(lastName))
    );
  });

  if (hasYear || hasDirector) return true;

  console.log(
    `[ingestion:scrape] Disambiguation failed: no mention of year ${year} or director "${director}" in header (first 2500 chars)`,
  );
  return false;
}

/**
 * Scrape death data from multiple web sources.
 * Strategy: parse the Fandom wiki programmatically for the death list (reliable),
 * then also fetch Wikipedia's plot summary for narrative context.
 * Both are passed to the LLM for enrichment.
 */
async function scrapeDeathData(
  title: string,
  year: number,
  director: string,
): Promise<ScrapedDeathData> {
  // Source 1: List of Deaths fandom wiki (primary — structured death list)
  const fandomResult = await scrapeFandomWiki(title, year);
  let parsedDeaths: ExtractedDeath[] = [];
  let fandomContent = "";

  if (fandomResult) {
    // Validate against FULL page text (year/director appear in the intro, not the Victims section)
    if (validateScrapedContent(fandomResult.fullText, year, director)) {
      console.log(
        `[ingestion:scrape] Found content on List of Deaths wiki (${fandomResult.content.length} chars)`,
      );
      parsedDeaths = parseFandomDeaths(fandomResult.content);
      fandomContent = fandomResult.content;
      console.log(
        `[ingestion:scrape] Parsed ${parsedDeaths.length} deaths from wikitext`,
      );
    } else {
      console.log(
        `[ingestion:scrape] Fandom content rejected (wrong movie — disambiguation failed)`,
      );
    }
  }

  // Source 2: Wikipedia plot summary (supplementary — narrative context)
  const wikiResult = await scrapeWikipediaPlot(title, year);
  let plotSummary = "";

  if (wikiResult) {
    // Validate against FULL page text (year/director appear in the intro, not the Plot section)
    if (validateScrapedContent(wikiResult.fullText, year, director)) {
      console.log(
        `[ingestion:scrape] Found Wikipedia plot summary (${wikiResult.content.length} chars)`,
      );
      plotSummary = wikiResult.content;
    } else {
      console.log(
        `[ingestion:scrape] Wikipedia content rejected (wrong movie — disambiguation failed)`,
      );
    }
  }

  // Source 3: The Movie Spoiler (fallback for plot summary)
  if (!plotSummary) {
    const spoilerResult = await scrapeMovieSpoiler(title, year);
    if (spoilerResult) {
      if (validateScrapedContent(spoilerResult.fullText, year, director)) {
        console.log(
          `[ingestion:scrape] Found Movie Spoiler content (${spoilerResult.content.length} chars)`,
        );
        plotSummary = spoilerResult.content;
      } else {
        console.log(
          `[ingestion:scrape] Movie Spoiler content rejected (wrong movie — disambiguation failed)`,
        );
      }
    }
  }

  if (!fandomContent && !plotSummary) {
    console.log(
      `[ingestion:scrape] No death data found from any source for "${title}"`,
    );
  }

  return {
    parsedDeaths,
    fandomContent,
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
export function parseFandomDeaths(wikitext: string): ExtractedDeath[] {
  const deaths: ExtractedDeath[] = [];

  const allLines = wikitext.split("\n");

  for (let i = 0; i < allLines.length; i++) {
    const rawLine = allLines[i];
    // Only process top-level bullets (single *)
    if (!rawLine.trim().startsWith("*") || rawLine.trim().startsWith("**"))
      continue;

    // Strip leading "* " and wiki markup
    let line = rawLine.replace(/^\*+\s*/, "");
    // Strip wiki formatting: bold ''', italic '', underline <u></u>, links [[]]
    line = line
      .replace(/<\/?u>/gi, "")
      .replace(/'{2,3}/g, "")
      .replace(
        /\[\[([^\]|]+)\|?([^\]]*)\]\]/g,
        (_m, _link, display) => display || _link,
      )
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
          .replace(
            /\[\[([^\]|]+)\|?([^\]]*)\]\]/g,
            (_m, _link, display) => display || _link,
          )
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
async function scrapeFandomWiki(
  title: string,
  year?: number,
): Promise<ScrapedResult | null> {
  // Try year-specific page first (e.g., "Jaws (1975)"), then plain title, then (film)
  const pageVariants = [
    ...(year ? [`${title} (${year})`] : []),
    title,
    `${title} (film)`,
  ];

  for (const pageTitle of pageVariants) {
    const url = `${FANDOM_API_BASE}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json`;
    console.log(
      `[ingestion:scrape] Trying List of Deaths wiki API: page="${pageTitle}"`,
    );

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "WDITMBot/1.0 (contact@whodiesinthismovie.com; movie death data research)",
        },
      });
      if (!response.ok) {
        console.log(
          `[ingestion:scrape] Fandom API returned ${response.status}`,
        );
        continue;
      }

      const data = await response.json();
      if (data.error) {
        console.log(
          `[ingestion:scrape] Fandom API error: ${data.error.info || data.error.code}`,
        );
        continue;
      }

      console.log(
        `[ingestion:scrape] Found List of Deaths wiki page="${pageTitle}"`,
      );
      const wikitext: string = data.parse?.wikitext?.["*"] || "";
      if (!wikitext || wikitext.length < 50) continue;

      const fullText = wikitext.slice(0, 20_000); // Full page for disambiguation

      // Extract the "Victims" section (primary death data) from wikitext
      const victimsMatch = wikitext.match(
        /==\s*Victims?\s*==\s*\n([\s\S]*?)(?:\n==\s*[^=]|$)/i,
      );
      if (victimsMatch) {
        const content = victimsMatch[1].trim();
        if (content.length > 20) {
          return { content: content.slice(0, 8000), fullText };
        }
      }

      // Fallback: return the whole wikitext if it contains death-related content
      if (
        wikitext.toLowerCase().includes("killed") ||
        wikitext.toLowerCase().includes("death")
      ) {
        return { content: wikitext.slice(0, 8000), fullText };
      }
    } catch (error) {
      console.log(
        `[ingestion:scrape] Fandom API error: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return null;
}

/**
 * Scrape Wikipedia for the movie's plot summary using the MediaWiki API.
 * The plot section typically describes deaths in narrative form.
 */
async function scrapeWikipediaPlot(
  title: string,
  year?: number,
): Promise<ScrapedResult | null> {
  // Try page titles in order of specificity
  const pageVariants = [
    ...(year ? [`${title} (${year} film)`] : []),
    `${title} (film)`,
    title,
  ];

  for (const pageTitle of pageVariants) {
    const url = `${WIKIPEDIA_API_BASE}?action=query&titles=${encodeURIComponent(pageTitle)}&prop=extracts&exsectionformat=plain&format=json`;
    console.log(
      `[ingestion:scrape] Trying Wikipedia API: page="${pageTitle}"`,
    );

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "WDITMBot/1.0 (contact@whodiesinthismovie.com; movie death data research)",
        },
      });
      if (!response.ok) {
        console.log(
          `[ingestion:scrape] Wikipedia API returned ${response.status}`,
        );
        continue;
      }

      const data = await response.json();
      const pages = data.query?.pages || {};
      const page = Object.values(pages)[0] as {
        extract?: string;
        missing?: boolean;
      };

      if (!page || page.missing || !page.extract) {
        console.log(
          `[ingestion:scrape] Wikipedia page not found: "${pageTitle}"`,
        );
        continue;
      }

      // The extract is HTML — parse with cheerio to find the Plot section
      // Truncate early to cap memory usage in this long-running process
      const extractHtml = (page.extract as string).slice(0, 100_000);
      let $ = cheerio.load(extractHtml);
      const fullPageText = $("body").text().trim().slice(0, 20_000); // Full page for disambiguation
      let plotText = "";

      // Wikipedia API extracts use <h2>, <h3> as section headers
      const plotHeader = $("h2, h3")
        .filter((_, el) => $(el).text().toLowerCase().includes("plot"))
        .first();

      if (plotHeader.length) {
        plotText = plotHeader
          .nextUntil("h2, h3") // everything until next section
          .filter("p") // only paragraphs
          .map((_, el) => $(el).text().trim())
          .get()
          .join("\n\n");
      }

      if (plotText.length > 100) {
        ($ as unknown) = null; // Release cheerio DOM for GC
        return { content: plotText.slice(0, 8000), fullText: fullPageText };
      }

      ($ as unknown) = null; // Release cheerio DOM for GC
      // Fallback: if no distinct "Plot" section, use the full extract
      if (fullPageText.length > 200) {
        console.log(
          `[ingestion:scrape] Wikipedia: no Plot section, using full extract`,
        );
        return {
          content: fullPageText.slice(0, 8000),
          fullText: fullPageText,
        };
      }
    } catch (error) {
      console.log(
        `[ingestion:scrape] Wikipedia API error: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return null;
}

/**
 * Scrape The Movie Spoiler for death-related content.
 * Uses Google-style search to find the right page since URL patterns vary.
 */
async function scrapeMovieSpoiler(
  title: string,
  year?: number,
): Promise<ScrapedResult | null> {
  // The Movie Spoiler uses various URL patterns; try direct URL first
  const baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/, "");
  const slugVariants = [
    ...(year ? [`${baseSlug}-${year}`] : []),
    baseSlug,
    baseSlug + "-the",
    "the-" + baseSlug,
  ];

  for (const slug of slugVariants) {
    const url = `${MOVIE_SPOILER_BASE}/${slug}`;
    console.log(`[ingestion:scrape] Trying The Movie Spoiler: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "WDITMBot/1.0 (contact@whodiesinthismovie.com; movie death data research)",
        },
        redirect: "follow",
      });
      if (!response.ok) {
        console.log(
          `[ingestion:scrape] Movie Spoiler returned ${response.status}`,
        );
        continue;
      }

      // Truncate HTML early to cap memory in this long-running process
      const html = (await response.text()).slice(0, 500_000);
      let $ = cheerio.load(html);

      // Remove non-content elements
      $("nav, header, footer, script, style, .sidebar, .comments").remove();

      // Try to find the main spoiler content area
      const content =
        $(".entry-content").length
          ? $(".entry-content").first()
          : $("article").length
            ? $("article").first()
            : $(".post-content").length
              ? $(".post-content").first()
              : null;

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
      return {
        content: combined.slice(0, 8000),
        fullText: combined.slice(0, 20_000),
      };
    } catch (error) {
      console.log(
        `[ingestion:scrape] Movie Spoiler error: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Job processing pipeline
// ---------------------------------------------------------------------------

/**
 * Process a single ingestion job end-to-end.
 * Throws on failure — caller is responsible for marking the job as failed.
 */
export async function processJob(
  job: IngestionJob,
  prisma: PrismaClient,
  config: ProcessJobConfig,
): Promise<string> {
  console.log(`[ingestion] Processing job #${job.id}: "${job.query}"`);

  // Step 1: LLM validation (currently disabled — always returns true)
  const isValidTitle = await validateMovieTitle(job.query, config.llmConfig);
  if (!isValidTitle) {
    throw new Error("LLM validation: not a real movie title");
  }

  // Step 2: Search TMDB for the movie (strip year from query if present)
  let tmdbQuery = job.query;
  const tmdbYear = job.year;
  if (tmdbYear) {
    const parsed = parseQueryWithYear(job.query);
    tmdbQuery = parsed.title;
  }
  console.log(
    `[ingestion:tmdb] Searching for "${tmdbQuery}"${tmdbYear ? ` (year: ${tmdbYear})` : ""}...`,
  );
  const searchResult = await searchTmdb(tmdbQuery, config.tmdbApiKey, tmdbYear);

  if (!searchResult) {
    throw new Error("Not found in TMDB");
  }

  const { tmdbId } = searchResult;
  console.log(
    `[ingestion:tmdb] Found: "${searchResult.title}" (tmdbId: ${tmdbId})`,
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
      `[ingestion] Duplicate detected: job #${duplicateJob.id} is already processing tmdbId ${tmdbId}`,
    );
    await prisma.ingestionQueue.update({
      where: { id: job.id },
      data: { status: "complete", completedAt: new Date() },
    });
    return searchResult.title;
  }

  // Check if movie already exists in the database
  const existingMovie = await prisma.movie.findUnique({
    where: { tmdbId },
  });

  if (existingMovie) {
    console.log(
      `[ingestion] Movie already in database: "${existingMovie.title}" (id: ${existingMovie.id})`,
    );
    await prisma.ingestionQueue.update({
      where: { id: job.id },
      data: { status: "complete", completedAt: new Date() },
    });
    return existingMovie.title;
  }

  // Step 4: Fetch full metadata from TMDB (3 parallel requests)
  console.log(
    `[ingestion:tmdb] Fetching full metadata for tmdbId ${tmdbId}...`,
  );
  const movieData = await fetchTmdbMetadata(tmdbId, config.tmdbApiKey);
  console.log(
    `[ingestion:tmdb] Metadata: "${movieData.title}" (${movieData.year}), director: ${movieData.director}, rating: ${movieData.mpaaRating}, runtime: ${movieData.runtime}min`,
  );

  // Rate limiting between TMDB and scraping
  await sleep(TMDB_RATE_LIMIT_MS);

  // Step 5: Scrape death data from web sources (Fandom wiki + Wikipedia plot)
  console.log(
    `[ingestion:scrape] Scraping death data for "${movieData.title}" (${movieData.year})...`,
  );
  const scraped = await scrapeDeathData(
    movieData.title,
    movieData.year,
    movieData.director,
  );

  // Step 6: Extract/enrich structured deaths via LLM (Gemini with retries)
  console.log(`[ingestion:llm] Extracting deaths from scraped content...`);
  const deaths = await extractDeaths(movieData.title, scraped, config.llmConfig);

  // Step 7: Insert into database (atomic transaction)
  // Wrapping upsert + delete + insert + queue update in a transaction ensures
  // the movie is never left with zero deaths if the process crashes mid-write.
  console.log(
    `[ingestion:db] Inserting movie and ${deaths.length} deaths...`,
  );

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
    `[ingestion:db] Successfully inserted "${movieData.title}" (movie.id=${movie.id}) with ${deaths.length} deaths`,
  );

  return movieData.title;
}

/**
 * Poll the queue for one pending job and process it.
 * Returns a result object describing what happened.
 */
export async function processQueue(
  prisma: PrismaClient,
  config: ProcessJobConfig,
): Promise<QueueResult> {
  // Pick the oldest pending job
  const job = await prisma.ingestionQueue.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    console.log("[ingestion] No pending jobs in queue");
    return { processed: false, reason: "no_jobs" };
  }

  // Mark as processing immediately (prevents duplicate pickup)
  await prisma.ingestionQueue.update({
    where: { id: job.id },
    data: { status: "processing" },
  });

  try {
    const title = await processJob(job as IngestionJob, prisma, config);
    return { processed: true, jobId: job.id, title };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    console.error(`[ingestion] Job #${job.id} failed: ${reason}`);

    await prisma.ingestionQueue.update({
      where: { id: job.id },
      data: { status: "failed", failureReason: reason.slice(0, 500) },
    });

    return { processed: true, jobId: job.id, failed: true, reason };
  }
}
