"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { decodeLyrics } = require("./lyrics");
const { loadEnv } = require("./load-env");
const { saveCredentials } = require("./credential-store");
const { bridgePaths, normalizeSession } = require("./desktop-bridge");

class ServiceError extends Error {
  constructor(code, retryMs = 30000) { super(code); this.code = code; this.retryMs = retryMs; }
}

class SpotifyService {
  constructor({ credentialFile, sessionFile = path.join(__dirname, "..", "session.json"), fetchImpl = fetch, env = process.env, envFile, loadEnvFile = env === process.env } = {}) {
    this.env = loadEnvFile ? loadEnv(env, envFile) : { ...env };
    this.credentialFile = credentialFile || this.env.SPOTIFYCARDS_CREDENTIAL_FILE || path.join(os.homedir(), ".config/MMM-SpotifyCards/credentials.json");
    this.fetch = fetchImpl;
    this.desktopTokenFile = bridgePaths(this.credentialFile).tokenFile;
    this.sessionFile = sessionFile;
    this.access = null;
    this.cache = new Map();
    this.lyricsBlockedUntil = 0;
  }

  setWebPlayerToken(token) { this.sessionWebToken = token; }
  setSessionCredentials(session = {}) {
    this.sessionCredentials = {
      clientId: typeof session.SPOTIFY_CLIENT_ID === "string" ? session.SPOTIFY_CLIENT_ID.trim() : "",
      clientSecret: typeof session.SPOTIFY_CLIENT_SECRET === "string" ? session.SPOTIFY_CLIENT_SECRET.trim() : "",
      refreshToken: typeof session.SPOTIFY_REFRESH_TOKEN === "string" ? session.SPOTIFY_REFRESH_TOKEN.trim() : ""
    };
  }

  async credentials() {
    let desktopToken;
    try { desktopToken = normalizeSession(JSON.parse(await fs.readFile(this.desktopTokenFile, "utf8"))).accessToken; }
    catch {} // An absent/expired desktop session leaves the existing sources available.
    let file = {};
    try { file = JSON.parse(await fs.readFile(this.credentialFile, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new ServiceError("credentials-invalid"); }
    return {
      desktopToken,
      spicyLyricsSecretKey: this.env.SPICY_LYRICS_SECRET_KEY || file.spicyLyricsSecretKey,
      clientId: this.sessionCredentials?.clientId || this.env.SPOTIFY_CLIENT_ID || file.clientId,
      clientSecret: this.sessionCredentials?.clientSecret || this.env.SPOTIFY_CLIENT_SECRET || file.clientSecret,
      refreshToken: this.sessionCredentials?.refreshToken || this.env.SPOTIFY_REFRESH_TOKEN || file.refreshToken,
      accessToken: this.env.SPOTIFY_ACCESS_TOKEN || file.accessToken,
      webPlayerToken: this.sessionWebToken || this.env.SPOTIFY_WEB_PLAYER_TOKEN || file.webPlayerToken
    };
  }

  async request(url, init, category) {
    try {
      const res = await this.fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(12000) });
      if (res.status === 204) return null;
      if (!res.ok) {
        const retry = res.headers.get("retry-after");
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
        const code = res.status === 429 ? `${category}-rate-limited`
          : [401, 403].includes(res.status) ? `${category}-auth`
          : res.status === 404 ? `${category}-not-found` : `${category}-unavailable`;
        throw new ServiceError(code, Number.isFinite(delay) ? Math.max(1000, delay) : 30000);
      }
      return await res.json();
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(`${category}-unavailable`);
    }
  }

  async playbackToken(force = false) {
    const c = await this.credentials();
    if (!force && this.access?.expires > Date.now()) return this.access.token;
    if (!c.refreshToken || !c.clientId) {
      if (c.accessToken) return c.accessToken.replace(/^Bearer\s+/i, "").trim();
      if (c.desktopToken) return c.desktopToken;
      if (c.webPlayerToken) return c.webPlayerToken.replace(/^Bearer\s+/i, "").trim();
      throw new ServiceError("playback-setup", 60000);
    }
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refreshToken, client_id: c.clientId });
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    if (c.clientSecret) headers.Authorization = `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
    const data = await this.request("https://accounts.spotify.com/api/token", { method: "POST", headers, body }, "playback");
    if (!data?.access_token) throw new ServiceError("playback-auth");
    this.access = { token: data.access_token, expires: Date.now() + Math.max(1, (data.expires_in || 3600) - 60) * 1000 };
    if (data.refresh_token && data.refresh_token !== c.refreshToken) {
      if (this.sessionCredentials?.refreshToken) {
        await saveCredentials(this.sessionFile, { SPOTIFY_REFRESH_TOKEN: data.refresh_token });
        this.sessionCredentials.refreshToken = data.refresh_token;
      } else if (this.env.SPOTIFY_REFRESH_TOKEN) this.env.SPOTIFY_REFRESH_TOKEN = data.refresh_token;
      else {
        // Preserve a web-player token that may have been updated during the refresh.
        let latest = {};
        try { latest = JSON.parse(await fs.readFile(this.credentialFile, "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw new ServiceError("credentials-invalid"); }
        await fs.writeFile(this.credentialFile, JSON.stringify({ ...latest, refreshToken: data.refresh_token }, null, 2), { mode: 0o600 });
      }
    }
    return this.access.token;
  }

  async playback() {
    let token = await this.playbackToken();
    const read = () => this.request("https://api.spotify.com/v1/me/player", { headers: { Authorization: `Bearer ${token}` } }, "playback");
    let data;
    try { data = await read(); }
    catch (error) {
      if (error.code !== "playback-auth") throw error;
      token = await this.playbackToken(true);
      data = await read();
    }
    const observedAt = Date.now();
    if (!data?.item) return { track: null, playing: false, progress: 0, observedAt };
    const item = data.item;
    const canFetch = item.type === "track" && !item.is_local && /^[a-zA-Z0-9]{22}$/.test(item.id || "");
    return { playing: !!data.is_playing, progress: data.progress_ms || 0, observedAt,
      device: String(data.device?.name || "Spotify"),
      track: { id: item.id || item.uri, lyricsId: canFetch ? item.id : null, title: String(item.name || "Untitled"),
        artist: item.artists?.map(a => a.name).join(", ") || item.show?.publisher || "Spotify",
        album: item.album?.name || item.show?.name || "", duration: item.duration_ms || 0,
        cover: (item.album?.images || item.images || []).find(i => /^https:\/\//.test(i.url))?.url || null }
    };
  }

  async lyrics(id) {
    if (!/^[a-zA-Z0-9]{22}$/.test(id)) throw new ServiceError("lyrics-unsupported");
    const cached = this.cache.get(id);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (Date.now() < this.lyricsBlockedUntil) throw new ServiceError("lyrics-rate-limited", this.lyricsBlockedUntil - Date.now());
    const c = await this.credentials();
    if (c.spicyLyricsSecretKey) {
      try {
        const data = await this.request(`https://api.spicylyrics.org/v1/lyrics/${id}`, {
          headers: { Authorization: `Bearer ${c.spicyLyricsSecretKey}` }
        }, "lyrics");
        if (data?.Status !== 200 || !data.Body) throw new ServiceError("lyrics-unavailable");
        let value;
        try { value = decodeLyrics(data.Body); } catch { throw new ServiceError("lyrics-format"); }
        this.remember(id, value, 3600000);
        return value;
      } catch (error) {
        if (error.code === "lyrics-not-found") { this.remember(id, null, 300000); return null; }
        if (error.code === "lyrics-rate-limited") this.lyricsBlockedUntil = Date.now() + error.retryMs;
        throw error;
      }
    }
    // Lyrics require the Web Player session, independently of playback OAuth.
    const token = c.desktopToken || c.webPlayerToken?.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new ServiceError("lyrics-setup");
    try {
      const data = await this.request("https://api.spicylyrics.org/query", {
        method: "POST", headers: { "Content-Type": "application/json", "X-mode": "2",
          "SpicyLyrics-WebAuth": `Bearer ${token}` },
        body: JSON.stringify({ queries: [{ operation: "lyrics", variables: { id, auth: "SpicyLyrics-WebAuth" } }],
          client: { version: "MMM-SpotifyCards/0.1.0" } })
      }, "lyrics");
      const result = data?.queries?.find(q => String(q.operationId) === "0")?.result;
      if (result?.httpStatus === 404) { this.remember(id, null, 300000); return null; }
      if (result?.httpStatus === 503) throw new ServiceError("lyrics-queued", 30000);
      if (result?.httpStatus === 429) throw new ServiceError("lyrics-rate-limited", 60000);
      if ([401, 403].includes(result?.httpStatus)) throw new ServiceError("lyrics-auth", 30000);
      if (result?.httpStatus !== 200) throw new ServiceError("lyrics-unavailable");
      let value;
      try { value = decodeLyrics(result.data); } catch { throw new ServiceError("lyrics-format"); }
      this.remember(id, value, 3600000);
      return value;
    } catch (error) {
      if (error.code === "lyrics-rate-limited") this.lyricsBlockedUntil = Date.now() + error.retryMs;
      throw error;
    }
  }

  remember(id, value, ttl) {
    this.cache.delete(id);
    this.cache.set(id, { value, expires: Date.now() + ttl });
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
  }
}

module.exports = { SpotifyService, ServiceError };
