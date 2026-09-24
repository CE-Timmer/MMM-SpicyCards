"use strict";
const { once } = require("node:events");
const { SpotifyService } = require("../lib/service");
const { saveCredentials } = require("../lib/credential-store");
const { cleanToken } = require("../lib/web-player-login");

const allowed = new Set(["clientId", "clientSecret", "refreshToken", "accessToken", "webPlayerToken", "spicyLyricsSecretKey"]);

async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    input += chunk;
    if (input.length > 32_768) process.stdin.destroy(new Error("Input is too large"));
  });
  await once(process.stdin, "end");
  return input;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log('printf \'{"webPlayerToken":"PASTE_TOKEN"}\' | npm run credentials');
    console.log("Optional keys: clientId, clientSecret, refreshToken, accessToken, webPlayerToken, spicyLyricsSecretKey");
    return;
  }
  if (process.stdin.isTTY) throw new Error("Paste JSON through standard input; see npm run credentials -- --help");
  const raw = await readStdin();
  let input;
  try { input = JSON.parse(raw); } catch { throw new Error("Input must be one JSON object"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Input must be one JSON object");
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key) || typeof value !== "string" || !value.trim()) throw new Error(`Invalid credential field: ${key}`);
    if (key === "spicyLyricsSecretKey" && !/^sl_sk_[A-Za-z0-9_-]+$/.test(value.trim())) throw new Error("Invalid Spicy Lyrics server key");
    patch[key] = key === "webPlayerToken" || key === "accessToken" ? cleanToken(value) : value.trim();
  }
  if (!Object.keys(patch).length) throw new Error("No credentials supplied");
  const service = new SpotifyService();
  if (service.env.SPOTIFY_WEB_PLAYER_TOKEN && patch.webPlayerToken) throw new Error("SPOTIFY_WEB_PLAYER_TOKEN overrides the credentials file");
  if (service.env.SPOTIFY_ACCESS_TOKEN && patch.accessToken) throw new Error("SPOTIFY_ACCESS_TOKEN overrides the credentials file");
  if (service.env.SPOTIFY_REFRESH_TOKEN && patch.refreshToken) throw new Error("SPOTIFY_REFRESH_TOKEN overrides the credentials file");
  if (service.env.SPICY_LYRICS_SECRET_KEY && patch.spicyLyricsSecretKey) throw new Error("SPICY_LYRICS_SECRET_KEY overrides the credentials file");
  await saveCredentials(service.credentialFile, patch);
  console.log(`Credentials saved to ${service.credentialFile}`);
}
main().catch(error => { console.error(`Credentials were not saved: ${error.message}`); process.exitCode = 1; });
