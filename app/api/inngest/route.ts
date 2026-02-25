import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { processMovieIngestion } from "@/inngest/process-movie-ingestion";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processMovieIngestion],
});
