import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  org: "friyay-projects",
  project: "whodiesinthismovie-website",
  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,
});
