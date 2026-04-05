const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createAnalytics } = require("./analytics");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const database = createAnalytics({
  matchesPath: path.join(ROOT, "matches.csv"),
  deliveriesPath: path.join(ROOT, "deliveries.csv")
});

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("We could not read that request."));
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": CONTENT_TYPES[".json"],
    ...buildSecurityHeaders(),
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  const extension = path.extname(filePath);
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, 404, { error: "Page not found." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType,
      ...buildSecurityHeaders(),
      "Cache-Control": buildCacheControl(extension)
    });
    response.end(content);
  });
}

function buildSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "manifest-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'"
    ].join("; ")
  };
}

function buildCacheControl(extension) {
  if (extension === ".html") {
    return "no-cache";
  }

  if (extension === ".css" || extension === ".js" || extension === ".svg" || extension === ".webmanifest" || extension === ".txt") {
    return "public, max-age=3600";
  }

  return "public, max-age=300";
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...buildSecurityHeaders(),
        "Allow": "GET,POST,OPTIONS"
      });
      response.end();
      return;
    }

    if (request.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      sendFile(response, path.join(ROOT, "index.html"));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/styles.css") {
      sendFile(response, path.join(ROOT, "styles.css"));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/app.js") {
      sendFile(response, path.join(ROOT, "app.js"));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/favicon.svg") {
      sendFile(response, path.join(ROOT, "favicon.svg"));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/site.webmanifest") {
      sendFile(response, path.join(ROOT, "site.webmanifest"));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/robots.txt") {
      sendFile(response, path.join(ROOT, "robots.txt"));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/meta") {
      sendJson(response, 200, database.buildMeta());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/dashboard") {
      sendJson(response, 200, database.buildDashboard(requestUrl.searchParams.get("team")));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/backtest") {
      sendJson(response, 200, database.buildBacktest());
      return;
    }

    if (request.method === "POST" && (requestUrl.pathname === "/api/predict" || requestUrl.pathname === "/predict")) {
      try {
        const payload = await readJsonBody(request);
        const prediction = database.buildPrediction(payload);

        if (prediction.error) {
          sendJson(response, 400, prediction);
          return;
        }

        sendJson(response, 200, prediction);
      } catch (error) {
        sendJson(response, 400, { error: "We could not complete that prediction right now." });
      }
      return;
    }

    sendJson(response, 404, { error: "Page not found." });
  } catch (error) {
    sendJson(response, 500, { error: "Something went wrong. Please try again." });
  }
});

server.listen(PORT, () => {
  console.log(`IPL Intelligence Hub running at http://127.0.0.1:${PORT}`);
});
