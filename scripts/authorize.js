"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { SpotifyService } = require("../lib/service");

async function main() {
  const service = new SpotifyService();
  const credentials = await service.credentials();
  const clientId = process.env.SPOTIFY_CLIENT_ID || process.argv[2] || credentials.clientId;
  if (!clientId) throw new Error("Usage: npm run auth -- YOUR_SPOTIFY_CLIENT_ID");
  const redirect = "http://127.0.0.1:8888/callback";
  const verifier = crypto.randomBytes(48).toString("base64url");
  const state = crypto.randomBytes(24).toString("hex");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirect,
    scope: "user-read-playback-state", code_challenge_method: "S256", code_challenge: challenge, state }).toString();
  let exchanging = false;
  const server = http.createServer(async (req, res) => {
    const callback = new URL(req.url, redirect);
    if (callback.pathname !== "/callback") { res.writeHead(404).end(); return; }
    if (callback.searchParams.get("state") !== state) { res.writeHead(400).end("Invalid authorization state"); return; }
    if (callback.searchParams.has("error")) { res.writeHead(400).end("Authorization declined. Run the command again to retry."); server.close(); clearTimeout(timeout); return; }
    if (!callback.searchParams.get("code") || exchanging) { res.writeHead(400).end("No authorization code, or exchange already in progress"); return; }
    exchanging = true;
    try {
      const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code: callback.searchParams.get("code"), redirect_uri: redirect, code_verifier: verifier }) });
      if (!response.ok) throw new Error(`Spotify rejected the exchange (${response.status})`);
      const token = await response.json();
      if (!token.refresh_token) throw new Error("Spotify returned no refresh token");
      let previous = {};
      try { previous = JSON.parse(await fs.readFile(service.credentialFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
      await fs.mkdir(path.dirname(service.credentialFile), { recursive: true });
      await fs.writeFile(service.credentialFile, JSON.stringify({ ...previous, clientId, refreshToken: token.refresh_token }, null, 2), { mode: 0o600 });
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Spotify playback connected. You can close this tab.");
      console.log(`Playback credentials saved to ${service.credentialFile}`);
    } catch { res.writeHead(500).end("Authorization failed. Run the command again to retry."); console.error("Authorization failed; credentials were not printed."); process.exitCode = 1; }
    finally { clearTimeout(timeout); server.close(); }
  });
  const timeout = setTimeout(() => { console.error("Authorization timed out after 5 minutes."); server.close(); process.exitCode = 1; }, 300000);
  server.on("error", error => { clearTimeout(timeout); console.error(`Cannot start callback listener: ${error.code}`); process.exitCode = 1; });
  server.listen(8888, "127.0.0.1", () => {
    console.log(`Add this exact redirect URI in your Spotify developer app: ${redirect}`);
    console.log(`Open this URL on this computer:\n${url}`);
  });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
