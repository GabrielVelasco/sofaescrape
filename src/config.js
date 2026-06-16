/**
 * Central configuration.
 * Override any value via environment variables.
 */

const config = {
  server: {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
  },
  cors: {
    enabled: process.env.CORS_ENABLED !== "false",
    credentials: process.env.CORS_CREDENTIALS !== "false",
    maxAge: Number(process.env.CORS_MAX_AGE ?? 86_400),
  },
  cache: {
    /**
     * Live events list TTL.
     * SofaScore refreshes live data ~every 5-10 s, so 5 s is a safe sweet-spot:
     * fresh enough for consumers, light enough on upstream.
     */
    liveTTLms: Number(process.env.LIVE_TTL_MS ?? 5_000),

    /**
     * Per-event statistics TTL.
     * Stats (possession, shots…) update less frequently than the score ticker,
     * so a slightly longer TTL is fine.
     */
    statsTTLms: Number(process.env.STATS_TTL_MS ?? 8_000),
  },
};

export default config;
