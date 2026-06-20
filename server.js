import config from "./src/config.js";
import { buildApp } from "./src/app.js";
import { closeBrowser } from "./src/sofaClient.js";

const fastify = await buildApp();

// ── Graceful shutdown ──────────────────────────────────────────────────────────

const shutdown = async (signal) => {
  fastify.log.info(`Received ${signal}, shutting down gracefully…`);
  await fastify.close();
  await closeBrowser();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

try {
  await fastify.listen({ host: config.server.host, port: config.server.port });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
