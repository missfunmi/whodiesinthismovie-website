-- CreateTable
CREATE TABLE "Movie" (
    "id" SERIAL NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "director" TEXT NOT NULL,
    "tagline" TEXT,
    "posterPath" TEXT,
    "runtime" INTEGER NOT NULL,
    "mpaaRating" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Death" (
    "id" SERIAL NOT NULL,
    "character" TEXT NOT NULL,
    "timeOfDeath" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "killedBy" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "isAmbiguous" BOOLEAN NOT NULL DEFAULT false,
    "movieId" INTEGER NOT NULL,

    CONSTRAINT "Death_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Movie_tmdbId_key" ON "Movie"("tmdbId");

-- CreateIndex
CREATE INDEX "Movie_title_idx" ON "Movie"("title");

-- CreateIndex
CREATE INDEX "Death_movieId_idx" ON "Death"("movieId");

-- AddForeignKey
ALTER TABLE "Death" ADD CONSTRAINT "Death_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
