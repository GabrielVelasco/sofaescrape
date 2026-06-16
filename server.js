/**
 * Entry point — assembles and starts the Fastify server.
 */

import Fastify from "fastify";
import config from "./src/config.js";
import routes from "./src/routes.js";
import { closeBrowser } from "./src/sofaClient.js";

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// ── CORS bypass ───────────────────────────────────────────────────────────────

if (config.cors.enabled) {
  fastify.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin ?? "*";
    const requestedHeaders = request.headers["access-control-request-headers"];

    reply
      .header("Access-Control-Allow-Origin", origin)
      .header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
      .header(
        "Access-Control-Allow-Headers",
        requestedHeaders || "Origin, X-Requested-With, Content-Type, Accept, Authorization"
      )
      .header("Access-Control-Max-Age", String(config.cors.maxAge))
      .header("Vary", "Origin, Access-Control-Request-Headers");

    if (config.cors.credentials) {
      reply.header("Access-Control-Allow-Credentials", "true");
    }

    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

const shutdown = async (signal) => {
  fastify.log.info(`Received ${signal}, shutting down gracefully…`);
  await fastify.close();
  await closeBrowser();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ── Boot ───────────────────────────────────────────────────────────────────────

await fastify.register(routes);

try {
  await fastify.listen({ host: config.server.host, port: config.server.port });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
