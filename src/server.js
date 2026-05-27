import { createServer } from "node:http";

import { config } from "./config.js";
import { handleApiRequest } from "./routes/api-routes.js";
import { handleV1Request } from "./routes/v1-routes.js";
import { handleProxyRequest } from "./routes/proxy-routes.js";
import { parseCookies, sendError, serveStaticFile } from "./utils/http.js";

const ALLOWED_HEADERS = "content-type, authorization, x-api-key, x-proxy-account-id";
const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

function applyCorsHeaders(request, response) {
  const origin = request.headers.origin;
  const allowedOrigins = config.allowedOrigins;

  if (allowedOrigins.length === 0) {
    if (!config.isProduction) {
      response.setHeader("access-control-allow-origin", origin || "*");
    }
  } else if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
    response.setHeader("access-control-allow-credentials", "true");
  }

  response.setHeader("access-control-allow-headers", ALLOWED_HEADERS);
  response.setHeader("access-control-allow-methods", ALLOWED_METHODS);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  request.cookies = parseCookies(request);

  applyCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApiRequest(request, response, url);
      if (!handled) {
        sendError(response, 404, "API route not found");
      }
      return;
    }

    if (url.pathname.startsWith("/proxy/")) {
      await handleProxyRequest(request, response, url, config.allowedProxyPaths);
      return;
    }

    if (url.pathname.startsWith("/v1/")) {
      const handled = await handleV1Request(request, response, url);
      if (!handled) {
        sendError(response, 404, "API route not found");
      }
      return;
    }

    if (!serveStaticFile(request, response, url.pathname)) {
      sendError(response, 404, "Page not found");
    }
  } catch (error) {
    console.error("[server] unhandled error:", error);

    if (response.headersSent || response.writableEnded) {
      response.destroy(error);
      return;
    }

    const message = config.isProduction ? "Internal Server Error" : (error?.message ?? "Internal Server Error");
    sendError(response, 500, message);
  }
});

server.listen(config.port, () => {
  console.log(`Server listening on http://127.0.0.1:${config.port}`);
});
