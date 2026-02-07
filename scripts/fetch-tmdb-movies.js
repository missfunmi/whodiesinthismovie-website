#!/usr/bin/env node
/**
 * Fetches movie metadata from TMDB API and outputs JSON
 *
 * Setup:
 * 1. Get free API key (bearer token) from https://www.themoviedb.org/settings/api
 * 2. Set environment variable: `export TMDB_API_KEY=your_access_token_here`
 * 3. Run: `node fetch-tmdb-movies.js`
 */
const fs = require("fs");
const https = require("https");

const API_KEY = process.env.TMDB_API_KEY;
const INPUT_FILE = "./tmdb-movie-ids.js";
const OUTPUT_FILE = "../data/seed-movies.json";

if (!API_KEY) {
  console.error("Error: TMDB_API_KEY environment variable not set");
  console.error(
    "Get your bearer token from: https://www.themoviedb.org/settings/api",
  );
  process.exit(1);
}

// Load movie IDs from config file
const MOVIE_IDS = require(INPUT_FILE);

function tmdbRequest(endpoint, movieId, context) {
  return new Promise((resolve, reject) => {
    const url = `https://api.themoviedb.org/3/movie/${movieId}${endpoint}?language=en-US`;

    const options = {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
    };

    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(
            new Error(
              `Failed to fetch ${context} for movie ${movieId}: ${res.statusCode} - ${data}`,
            ),
          );
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function fetchMovie(id) {
  return tmdbRequest("", id, "movie");
}

function fetchCredits(id) {
  return tmdbRequest("/credits", id, "credits");
}

function fetchReleases(id) {
  return tmdbRequest("/release_dates", id, "release dates");
}

async function fetchAllMovies() {
  // Write to output file in real time as we fetch each movie's metadata
  // This will replace any file at the output location, so backup before running, if needed
  const stream = fs.createWriteStream(OUTPUT_FILE, { flags: "w" });
  stream.write("[\n"); // Start the array

  for (const [index, id] of MOVIE_IDS.entries()) {
    try {
      // Fetch metadata in parallel
      const [movie, credits, releases] = await Promise.all([
        fetchMovie(id),
        fetchCredits(id),
        fetchReleases(id),
      ]);

      // Extract all directors, some movies may have more than one
      const directors = credits.crew
        .filter((crewMember) => crewMember.job === "Director")
        .map((crewMember) => crewMember.name);

      // Find the first theatrical (3) or premiere (1/2) rating
      const usRelease = releases.results.find((r) => r.iso_3166_1 === "US");
      const theatricalRelease =
        usRelease?.release_dates.find((rd) => rd.type === 3) ||
        usRelease?.release_dates[0];
      const mpaaRating = theatricalRelease?.certification || "NR"; // Fallback to NR (Not Rated)

      // Transform to our schema
      const movieData = {
        tmdbId: movie.id,
        title: movie.title,
        year: new Date(movie.release_date).getFullYear(),
        director: directors.join(", ") || null,
        tagline: movie.tagline || null,
        posterPath: movie.poster_path,
        runtime: movie.runtime,
        mpaaRating: mpaaRating,
      };

      // Rate limiting: wait 500ms between requests for each movie
      await new Promise((resolve) => setTimeout(resolve, 500));

      const isLast = index === MOVIE_IDS.length - 1;
      stream.write(JSON.stringify(movieData, null, 2) + (isLast ? "" : ",\n"));
    } catch (error) {
      console.error(
        `Failed at index ${index}; skipping movie ID ${id} due to error:`,
        error.message,
      );
    }
  }

  stream.write("\n]");
  stream.end();
}

// Main execution
(async () => {
  try {
    await fetchAllMovies();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
