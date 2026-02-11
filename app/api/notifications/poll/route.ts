import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Return movies added in the last 24 hours. The notification bell's
    // localStorage pruning uses a longer 7-day window to prevent movies
    // briefly re-appearing as "unread" near the 24h boundary.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentMovies = await prisma.movie.findMany({
      where: {
        createdAt: {
          gt: twentyFourHoursAgo,
        },
      },
      select: {
        tmdbId: true,
        title: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(recentMovies, {
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
    });
  } catch (error) {
    console.error("Failed to poll notifications:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    );
  }
}
