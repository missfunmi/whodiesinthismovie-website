import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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

    return NextResponse.json(recentMovies);
  } catch (error) {
    console.error("Failed to poll notifications:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    );
  }
}
