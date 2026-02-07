#!/usr/bin/env node
/**
 * Converts a CSV of death data to JSON format
 *
 * CSV format:
 * movieTitle, character, timeOfDeath, cause, killedBy, context, isAmbiguous
 *
 * Run: node csv-to-deaths-json.js seed-deaths.csv > seed-deaths.json
 */

const fs = require("fs");

const csvFile = process.argv[2];

if (!csvFile) {
  console.error("Usage: node csv-to-deaths-json.js <csv-file>");
  process.exit(1);
}

const csvContent = fs.readFileSync(csvFile, "utf-8");
const lines = csvContent.trim().split("\n");
const headers = lines[0].split(",").map((h) => h.trim());

// Group deaths by movie
const movieDeaths = {};

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue; // Skip truly empty lines

  /**
   * Robust CSV Split: Handles commas inside quoted strings
   * This regex looks for commas that are not inside double quotes.
   */
  const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((v) => {
    let clean = v.trim();
    // Remove wrapping quotes if they exist
    return clean.replace(/^"|"$/g, "").trim();
  });

  const row = {};
  headers.forEach((header, index) => {
    row[header] = values[index] || "";
  });

  if (!row.movieTitle) continue;

  const movieTitle = row.movieTitle;

  // Initialize movie entry if it doesn't exist
  if (!movieDeaths[movieTitle]) {
    movieDeaths[movieTitle] = {
      movieTitle: movieTitle,
      tmdbId: parseInt(row.tmdbId) || 0,
      deaths: [],
    };
  }

  // Push the character data into the deaths array
  movieDeaths[movieTitle].deaths.push({
    character: row.character,
    timeOfDeath: row.timeOfDeath,
    cause: row.cause,
    killedBy: row.killedBy || "N/A",
    context: row.context,
    isAmbiguous: row.isAmbiguous.toLowerCase() === "true",
  });
}

// Convert the object map into the final array format
const output = Object.values(movieDeaths);

console.log(JSON.stringify(output, null, 2));
