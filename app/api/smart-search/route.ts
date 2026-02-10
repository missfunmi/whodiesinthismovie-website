import { NextRequest, NextResponse } from "next/server";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://localhost:8000";
const RAG_TIMEOUT_MS = 5000;
const MAX_QUERY_LENGTH = 200;

// TODO - Revisit when easter egg is implemented
export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Invalid query format" },
        { status: 400 },
      );
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Query exceeds ${MAX_QUERY_LENGTH} characters` },
        { status: 400 },
      );
    }

    // Input sanitization: Remove potential script tags and attributes
    // TODO: Switch to using 'sanitize-html' or 'dompurify'
    const sanitizedQuery = trimmedQuery
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
      .replace(/on\w+="[^"]*"/gim, "")
      .replace(/<[^>]*>/g, "");

    // Forward to Python RAG service with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);

    try {
      const response = await fetch(`${RAG_SERVICE_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sanitizedQuery }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return NextResponse.json(
          { error: "Smart search service returned an error" },
          { status: 502 },
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    } catch (fetchError: unknown) {
      clearTimeout(timeout);

      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return NextResponse.json(
          { error: "The oracle is thinking too hard... try again?" },
          { status: 504 },
        );
      }

      // Connection refused or other network error
      return NextResponse.json(
        { error: "Smart search is offline right now" },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error("Smart search API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
