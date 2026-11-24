const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Relay server is running");
});

const wss = new WebSocketServer({ server, maxPayload: 100 * 1024 * 1024 });

const clients = new Set();

function sendJson(ws, obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

function getByRole(role) {
  return Array.from(clients).filter((c) => c.readyState === 1 && c.role === role);
}

wss.on("connection", (ws) => {
  ws.role = "unknown";
  ws.deviceId = "";
  clients.add(ws);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "REGISTER" || msg.action === "REGISTER") {
      ws.role = String(msg.role || "unknown").toLowerCase();
      ws.deviceId = String(msg.deviceId || "");
      sendJson(ws, { type: "REGISTERED", role: ws.role, deviceId: ws.deviceId });
      return;
    }

    const msgType = String(msg.type || "").toUpperCase();
    const action = String(msg.action || "").toUpperCase();

    const dataServers = getByRole("data_server");
    const phones = getByRole("phone");
    const viewers = getByRole("viewer");

    // 1. Phone -> data-server ingestion & acknowledgements
    if (
      msgType === "INGEST_CHUNK" || action === "INGEST_CHUNK" ||
      msgType === "FILE_CHUNK" || action === "FILE_CHUNK" ||
      msgType === "LIVE_AUDIO_CHUNK" || action === "LIVE_AUDIO_CHUNK"
    ) {
      for (const ds of dataServers) sendJson(ds, msg);
      return;
    }

    if (
      msgType === "INGEST_ACK" ||
      msgType === "FILE_CHUNK_ACK" ||
      msgType === "LIVE_AUDIO_ACK"
    ) {
      for (const ph of phones) sendJson(ph, msg);
      return;
    }

    // 2. Viewer -> data-server queries
    if (
      action === "GET_BATCH_SUMMARY" ||
      action === "GET_BATCH_ITEMS" ||
      action === "GET_STORED_FILE" ||
      action === "GET_LIVE_AUDIO"
    ) {
      if (dataServers.length > 0) {
        for (const ds of dataServers) {
          sendJson(ds, { ...msg, _replyToViewer: true });
        }
      } else {
        for (const ph of phones) sendJson(ph, msg);
      }
      return;
    }

    // 3. data-server -> Viewer responses
    if (
      msgType === "BATCH_SUMMARY" ||
      msgType === "BATCH_ITEMS" ||
      msgType === "STORED_FILE" ||
      msgType === "STORED_FILE_MISSING" ||
      msgType === "LIVE_AUDIO_ITEMS"
    ) {
      for (const vw of viewers) sendJson(vw, msg);
      return;
    }

    // 4. Live Viewer -> Phone commands
    if (msgType === "COMMAND" || action.startsWith("GET_") || action.startsWith("SYNC_")) {
      for (const ph of phones) sendJson(ph, msg);
      return;
    }

    // 5. Phone -> Viewer live responses
    for (const vw of viewers) {
      if (vw !== ws) sendJson(vw, msg);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log("Relay listening on port", PORT);
});
