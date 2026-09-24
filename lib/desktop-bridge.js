"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { saveCredentials } = require("./credential-store");
const { cleanToken } = require("./web-player-login");

const ROUTE = "/spotifycards/token";
const ORIGINS = new Set(["https://xpui.app.spotify.com", "https://open.spotify.com"]);

function bridgePaths(credentialFile) {
  const directory = path.dirname(credentialFile);
  return { configFile: path.join(directory, "desktop-bridge.json"), tokenFile: path.join(directory, "desktop-session.json") };
}

function normalizeSession(value, now = Date.now()) {
  const accessToken = cleanToken(value?.accessToken);
  const expiresAt = value?.expiresAt;
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 30000 || expiresAt > now + 86400000) throw new Error("invalid-expiry");
  return { accessToken, expiresAt };
}

function validKey(key) { return typeof key === "string" && /^[a-zA-Z0-9_-]{32,128}$/.test(key); }

function createDesktopReceiver({ pairingKey, tokenFile, onToken = () => {} }) {
  if (!validKey(pairingKey)) throw new Error("invalid-pairing-key");
  let writing = Promise.resolve();
  const expected = Buffer.from(pairingKey);
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.url !== ROUTE) return reply(404, { error: "not-found" });
    const origin = req.headers.origin;
    if (origin && !ORIGINS.has(origin)) return reply(403, { error: "origin-not-allowed" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-SpotifyCards-Key");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      return reply(204);
    }
    if (req.method !== "POST") return reply(405, { error: "method-not-allowed" });
    const supplied = Buffer.from(String(req.headers["x-spotifycards-key"] || ""));
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return reply(401, { error: "invalid-pairing-key" });
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) return reply(415, { error: "json-required" });
    let size = 0, chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) { reply(413, { error: "body-too-large" }); req.resume(); return; }
        chunks.push(chunk);
      }
      const session = normalizeSession(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      // Serialize writes to avoid two desktops leaving a partially replaced file.
      const pending = writing.then(() => saveCredentials(tokenFile, { ...session, receivedAt: Date.now() }));
      writing = pending.catch(() => {});
      await pending;
      onToken();
      reply(200, { ok: true, expiresAt: session.expiresAt });
    } catch (error) {
      const invalid = error instanceof SyntaxError || ["invalid-token", "invalid-expiry"].includes(error.message);
      reply(invalid ? 400 : 500, { error: invalid ? "invalid-session" : "save-failed" });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

function startDesktopBridge({ credentialFile, onToken, onError = () => {}, onListening = () => {} }) {
  const { configFile, tokenFile } = bridgePaths(credentialFile);
  let config;
  try { config = JSON.parse(fs.readFileSync(configFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") onError("invalid-config"); return null; }
  if (!config.enabled) return null;
  if (!validKey(config.pairingKey) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || typeof config.host !== "string" || !config.host.trim()) {
    onError("invalid-config"); return null;
  }
  const server = createDesktopReceiver({ pairingKey: config.pairingKey, tokenFile, onToken });
  server.on("error", error => onError(error.code === "EADDRINUSE" ? "port-in-use" : "listen-failed"));
  server.listen(config.port, config.host, () => onListening(config.host, config.port));
  return server;
}

module.exports = { bridgePaths, normalizeSession, validKey, createDesktopReceiver, startDesktopBridge, ROUTE };
