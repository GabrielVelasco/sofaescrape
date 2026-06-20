/**
 * Route definitions.
 *
 * Exposed endpoints
 * ─────────────────
 *  GET /api/live                  → SofaScore live events
 *  GET /api/:eventId/stats        → per-event statistics
 *  GET /health                    → liveness probe (no upstream call)
 */

import { sofaFetch } from "./sofaClient.js";
import TTLCache from "./cache.js";
import config from "./config.js";

// Shared cache instance (lives for the lifetime of the process)
const cache = new TTLCache();

function upstreamBodyPreview(data) {
  if (typeof data === "string") return data.slice(0, 300);

  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return "[unserializable upstream body]";
  }
}

// Purge stale entries every minute so the Map never grows unboundedly
setInterval(() => cache.purgeExpired(), 60_000).unref();

// ─── Schema helpers ────────────────────────────────────────────────────────────

const errorSchema = {
  type: "object",
  properties: {
    error: { type: "string" },
    upstream_status: { type: "number" },
  },
};

const proxyJsonSchema = {
  type: "object",
  additionalProperties: true,
};

// ─── Route plugin ─────────────────────────────────────────────────────────────

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function routes(fastify) {
  // ── Health check ────────────────────────────────────────────────────────────
  fastify.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              cache_entries: { type: "number" },
              uptime_s: { type: "number" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.send({
        status: "ok",
        cache_entries: cache.size,
        uptime_s: Math.round(process.uptime()),
      });
    }
  );

  // ── GET /api/live ───────────────────────────────────────────────────────────
  fastify.get(
    "/api/live",
    {
      schema: {
        response: { 200: proxyJsonSchema, "4xx": errorSchema, "5xx": errorSchema },
      },
    },
    async (req, reply) => {
      const cacheKey = "live";
      const cached = cache.get(cacheKey);

      if (cached) {
        reply.header("X-Cache", "HIT");
        return reply.send(cached);
      }

      try {
        const { data, status, url, contentType } = await sofaFetch(
          "/sport/football/events/live"
        );

        if (status >= 400) {
          req.log.warn({
            upstreamStatus: status,
            upstreamUrl: url,
            upstreamContentType: contentType,
            upstreamBodyPreview: upstreamBodyPreview(data),
          }, "SofaScore upstream rejected live events request");

          return reply.status(status).send({
            error: "Upstream error",
            upstream_status: status,
          });
        }

        cache.set(cacheKey, data, config.cache.liveTTLms);
        reply.header("X-Cache", "MISS");

        return reply.send(data);
        
      } catch (err) {
        req.log.error({ err }, "Failed to fetch live events");
        return reply.status(502).send({ error: "Bad gateway", upstream_status: 0 });
      }
    }
  );

  // ── GET /api/:eventId/stats ─────────────────────────────────────────────────
  fastify.get(
    "/api/:eventId/stats",
    {
      schema: {
        params: {
          type: "object",
          properties: { eventId: { type: "string", pattern: "^[0-9]+$" } },
          required: ["eventId"],
        },
        response: { 200: proxyJsonSchema, "4xx": errorSchema, "5xx": errorSchema },
      },
    },
    async (req, reply) => {
      const { eventId } = req.params;
      const cacheKey = `stats:${eventId}`;
      const cached = cache.get(cacheKey);

      if (cached) {
        reply.header("X-Cache", "HIT");
        return reply.send(cached);
      }

      try {
        const { data, status, url, contentType } = await sofaFetch(
          `/event/${eventId}/statistics`
        );

        if (status === 404) {
          return reply.status(404).send({
            error: `Event ${eventId} not found`,
            upstream_status: 404,
          });
        }

        if (status >= 400) {
          req.log.warn({
            upstreamStatus: status,
            upstreamUrl: url,
            upstreamContentType: contentType,
            upstreamBodyPreview: upstreamBodyPreview(data),
            eventId,
          }, "SofaScore upstream rejected event stats request");

          return reply.status(status).send({
            error: "Upstream error",
            upstream_status: status,
          });
        }

        cache.set(cacheKey, data, config.cache.statsTTLms);
        reply.header("X-Cache", "MISS");

        return reply.send(data);
      } catch (err) {
        req.log.error({ err, eventId }, "Failed to fetch event stats");
        return reply.status(502).send({ error: "Bad gateway", upstream_status: 0 });
      }
    }
  );
}
