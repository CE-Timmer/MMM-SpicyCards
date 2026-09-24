"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { SpotifyService } = require("./service");
const { WebPlayerLogin } = require("./web-player-login");
const { saveCredentials } = require("./credential-store");

function createSetupServer({ service = new SpotifyService(), login = new WebPlayerLogin({ credentialFile: service.credentialFile, env: service.env }), fetchImpl = fetch } = {}) {
  const csrf = crypto.randomBytes(32).toString("hex");
  let authorization = null;
  function json(res, status, body) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); }
  async function body(req) {
    let text = "";
    for await (const chunk of req) { text += chunk; if (text.length > 12000) throw new Error("request-too-large"); }
    return JSON.parse(text || "{}");
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = `127.0.0.1:${server.address().port}`;
    const origin = `http://${host}`;
    if (req.headers.host !== host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return json(res, 403, { error: "local-access-only" });
    const url = new URL(req.url, origin);
    try {
      if (req.method === "POST") {
        if (req.headers.origin !== origin || req.headers["x-setup-csrf"] !== csrf || !req.headers["content-type"]?.startsWith("application/json")) return json(res, 403, { error: "invalid-setup-request" });
        const input = await body(req);
        if (url.pathname === "/api/web-login") { void login.start(); return json(res, 202, { started: true }); }
        if (url.pathname === "/api/cancel") { await login.cancel(); return json(res, 200, { cancelled: true }); }
        if (url.pathname === "/api/token") {
          await login.cancel(); await login.save(input.token);
          return json(res, 200, { saved: true });
        }
        if (url.pathname === "/api/playback-login") {
          if (service.env.SPOTIFY_CLIENT_ID || service.env.SPOTIFY_REFRESH_TOKEN || service.env.SPOTIFY_CLIENT_SECRET || service.env.SPOTIFY_ACCESS_TOKEN) return json(res, 409, { error: "environment-override" });
          if (typeof input.clientId !== "string" || !/^[a-fA-F0-9]{32}$/.test(input.clientId)) return json(res, 400, { error: "invalid-client-id" });
          const state = crypto.randomBytes(32).toString("hex");
          const verifier = crypto.randomBytes(48).toString("base64url");
          authorization = { state, verifier, clientId: input.clientId, expires: Date.now() + 300000 };
          const params = new URLSearchParams({ client_id: input.clientId, response_type: "code", redirect_uri: `${origin}/callback`, scope: "user-read-playback-state", state,
            code_challenge_method: "S256", code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url") });
          return json(res, 200, { url: `https://accounts.spotify.com/authorize?${params}` });
        }
        return json(res, 404, { error: "not-found" });
      }
      if (req.method !== "GET") return json(res, 405, { error: "method-not-allowed" });
      if (url.pathname === "/api/status") {
        const c = await service.credentials();
        return json(res, 200, { csrf, redirectUri: `${origin}/callback`, playbackConfigured: !!(c.refreshToken && c.clientId || c.accessToken || c.webPlayerToken),
          playbackMode: c.refreshToken && c.clientId ? "refresh-token" : c.accessToken ? "access-token" : c.webPlayerToken ? "web-session" : "none",
          webTokenConfigured: !!c.webPlayerToken, clientId: c.clientId || "", login: login.status(), webTokenEnvironment: !!service.env.SPOTIFY_WEB_PLAYER_TOKEN });
      }
      if (url.pathname === "/callback") {
        const pending = authorization;
        if (!pending || pending.expires < Date.now() || url.searchParams.get("state") !== pending.state) return json(res, 400, { error: "invalid-oauth-state" });
        authorization = null;
        if (url.searchParams.has("error")) { res.writeHead(303, { Location: "/?result=declined" }); return res.end(); }
        const code = url.searchParams.get("code");
        if (!code) return json(res, 400, { error: "missing-code" });
        try {
          const response = await fetchImpl("https://accounts.spotify.com/api/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "authorization_code", client_id: pending.clientId, code, redirect_uri: `${origin}/callback`, code_verifier: pending.verifier }) });
          if (!response.ok) throw new Error("oauth-failed");
          const token = await response.json();
          if (!token.refresh_token) throw new Error("oauth-failed");
          await saveCredentials(service.credentialFile, { clientId: pending.clientId, refreshToken: token.refresh_token, clientSecret: null, accessToken: null });
          res.writeHead(303, { Location: "/?result=connected" }); res.end();
        } catch { res.writeHead(303, { Location: "/?result=failed" }); res.end(); }
        return;
      }
      const files = { "/": "index.html", "/setup.js": "setup.js", "/setup.css": "setup.css" };
      if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
      if (!files[url.pathname]) return json(res, 404, { error: "not-found" });
      const file = files[url.pathname];
      const content = await fs.readFile(path.join(__dirname, "../setup", file));
      res.writeHead(200, { "Content-Type": file.endsWith("html") ? "text/html; charset=utf-8" : file.endsWith("css") ? "text/css" : "text/javascript" }); res.end(content);
    } catch (error) {
      const allowed = ["environment-override", "invalid-token", "token-not-accepted", "credentials-invalid", "request-too-large"];
      json(res, 400, { error: allowed.includes(error.message) ? error.message : "setup-failed" });
    }
  });
  server.closeLogin = () => login.cancel();
  return server;
}
module.exports = { createSetupServer };
