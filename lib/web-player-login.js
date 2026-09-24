"use strict";
const path = require("node:path");
const fs = require("node:fs/promises");
const { saveCredentials } = require("./credential-store");

function cleanToken(value) {
  if (typeof value !== "string") throw new Error("invalid-token");
  const token = value.replace(/^Bearer\s+/i, "").trim();
  if (token.length < 20 || token.length > 8192 || /\s/.test(token)) throw new Error("invalid-token");
  return token;
}

async function validateToken(token, fetchImpl = fetch) {
  const response = await fetchImpl("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("token-not-accepted");
  const profile = await response.json();
  if (!profile?.id) throw new Error("token-not-accepted");
}

async function launchBrowser(profile, env) {
  const { chromium } = require("playwright");
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const common = { headless: false, viewport: null, chromiumSandbox: true };
  if (env.SPOTIFYCARDS_BROWSER_PATH) return chromium.launchPersistentContext(profile, { ...common, executablePath: env.SPOTIFYCARDS_BROWSER_PATH });
  // Opera is Chromium-based. Prefer an installed copy over Edge so the setup
  // login is usable without changing Windows' global default browser.
  if (process.platform === "win32") {
    const opera = [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Opera", "opera.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Opera GX", "opera.exe"),
      path.join(process.env.ProgramFiles || "", "Opera", "opera.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Opera", "opera.exe")
    ];
    for (const executablePath of opera) {
      try { await fs.access(executablePath); return await chromium.launchPersistentContext(profile, { ...common, executablePath }); } catch {}
    }
  }
  const channels = env.SPOTIFYCARDS_BROWSER_CHANNEL ? [env.SPOTIFYCARDS_BROWSER_CHANNEL]
    : process.platform === "win32" ? ["msedge", "chrome", undefined] : ["chrome", undefined];
  for (const channel of channels) {
    try { return await chromium.launchPersistentContext(profile, { ...common, channel }); } catch {}
  }
  throw new Error("browser-unavailable");
}

class WebPlayerLogin {
  constructor({ credentialFile, env = process.env, fetchImpl = fetch, launcher = launchBrowser, saver = saveCredentials }) {
    Object.assign(this, { credentialFile, env, fetchImpl, launcher, saver });
    this.state = "idle";
    this.generation = 0;
  }
  status() { return { state: this.state, savedAt: this.savedAt || null }; }
  async save(token) {
    if (this.env.SPOTIFY_WEB_PLAYER_TOKEN) throw new Error("environment-override");
    token = cleanToken(token);
    await validateToken(token, this.fetchImpl);
    await this.saver(this.credentialFile, { webPlayerToken: token });
    this.savedAt = Date.now();
    this.state = "saved";
  }
  async start() {
    if (["opening", "waiting", "saving"].includes(this.state)) return;
    if (this.env.SPOTIFY_WEB_PLAYER_TOKEN) { this.state = "environment-override"; return; }
    const generation = ++this.generation;
    this.state = "opening";
    let context;
    try {
      context = await this.launcher(path.join(path.dirname(this.credentialFile), "web-player-profile"), this.env);
      if (generation !== this.generation) { await context.close(); return; }
      this.context = context;
      this.state = "waiting";
      const attempted = new Set();
      let checking = false;
      context.on("close", () => {
        if (this.context === context) this.context = null;
        if (generation === this.generation && ["opening", "waiting"].includes(this.state)) this.state = "cancelled";
        clearTimeout(this.timer);
      });
      // Observe only successful requests made by the user's dedicated Web Player
      // page to Spotify's own API. Never inspect login form fields or cookies.
      context.on("response", async response => {
        try {
          if (generation !== this.generation || checking || this.state !== "waiting" || !response.ok()) return;
          const url = new URL(response.url());
          if (url.protocol !== "https:" || !(url.hostname === "api.spotify.com" || url.hostname === "api-partner.spotify.com" || /^(?:[a-z0-9-]+-)?spclient(?:\.[a-z0-9-]+)*\.spotify\.com$/.test(url.hostname))) return;
          const request = response.request();
          if (new URL(request.frame().url()).origin !== "https://open.spotify.com") return;
          const headers = await request.allHeaders();
          if (!headers.authorization?.startsWith("Bearer ")) return;
          const token = cleanToken(headers.authorization);
          if (attempted.has(token)) return;
          checking = true;
          attempted.add(token);
          try { await validateToken(token, this.fetchImpl); }
          catch { checking = false; return; } // Ignore anonymous/expired tokens.
          if (generation !== this.generation) return;
          this.state = "saving";
          await this.saver(this.credentialFile, { webPlayerToken: token });
          this.savedAt = Date.now();
          this.state = "saved";
          clearTimeout(this.timer);
          await context.close();
        } catch {
          checking = false;
          if (this.state === "saving") { this.state = "save-failed"; await context.close().catch(() => {}); }
        }
      });
      this.timer = setTimeout(() => { if (generation === this.generation) { this.state = "timed-out"; this.generation++; context.close().catch(() => {}); } }, 300000);
      this.timer.unref?.();
      const page = context.pages()[0] || await context.newPage();
      await page.goto("https://open.spotify.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch {
      if (generation === this.generation && this.state !== "saved") {
        this.state = context ? "navigation-failed" : "browser-unavailable";
        clearTimeout(this.timer);
        await context?.close().catch(() => {});
      }
    }
  }
  async cancel() {
    this.generation++;
    clearTimeout(this.timer);
    if (["opening", "waiting"].includes(this.state)) this.state = "cancelled";
    await this.context?.close().catch(() => {});
    this.context = null;
  }
}
module.exports = { WebPlayerLogin, cleanToken, validateToken };
