import Fastify from "fastify";
import config from "./config.js";
import routes from "./routes.js";

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  if (config.cors.enabled) {
    fastify.addHook("onRequest", async (request, reply) => {
      const origin = request.headers.origin;
      const requestedHeaders = request.headers["access-control-request-headers"];
      const isApiRequest = request.url.startsWith("/api/");
      const isAllowedOrigin = origin && config.cors.allowedOrigins.includes(origin);

      if (isApiRequest && !isAllowedOrigin) {
        return reply.status(403).send({ error: "Forbidden origin" });
      }

      reply
        .header("Access-Control-Allow-Origin", isAllowedOrigin ? origin : "null")
        .header("Access-Control-Allow-Methods", "GET,OPTIONS")
        .header(
          "Access-Control-Allow-Headers",
          requestedHeaders || "Origin, X-Requested-With, Content-Type, Accept"
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

  await fastify.register(routes);
  return fastify;
}
