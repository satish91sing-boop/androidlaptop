const http = require("http");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const KEEP_ALIVE_INTERVAL_MS = 11 * 60 * 1000; // 11 minutes (< 15 min Render idle timeout)
const SELF_PING_URL = process.env.RENDER_EXTERNAL_URL || "";

// Standard HTTP handler so Render health checks and browser visits don't fail awkwardly
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket relay is running.");
});

// Attach WebSocket server to the same HTTP server instance
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`Client connected from ${clientIp}`);

  ws.on("message", (data, isBinary) => {
    // Relay messages to other connected peers (e.g., browser <-> Android client)
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    });
  });

  ws.on("close", (code, reason) => {
    console.log(`Client disconnected (code: ${code}, reason: ${reason.toString()})`);
  });

  ws.on("error", (err) => {
    console.error("WebSocket client error:", err.message);
  });
});

// Automated periodic ping every 11 minutes:
// 1) Sends WebSocket ping frames to active connected clients
// 2) Hits the public HTTP URL (if RENDER_EXTERNAL_URL is set) to register HTTP activity
setInterval(() => {
  console.log("[Keep-Alive] Running scheduled 11-minute ping...");

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.ping();
      } catch (err) {
        console.error("[Keep-Alive] Socket ping failed:", err.message);
      }
    }
  });

  if (SELF_PING_URL) {
    const clientModule = SELF_PING_URL.startsWith("https://") ? https : http;
    clientModule
      .get(SELF_PING_URL, (res) => {
        console.log(`[Keep-Alive] Self-ping status: ${res.statusCode}`);
        res.resume();
      })
      .on("error", (err) => {
        console.error("[Keep-Alive] Self-ping error:", err.message);
      });
  } else {
    console.log("[Keep-Alive] RENDER_EXTERNAL_URL not set; skipped HTTP self-ping.");
  }
}, KEEP_ALIVE_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`Relay server listening on port ${PORT}`);
});