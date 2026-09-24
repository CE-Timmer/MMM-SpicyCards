"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function settings(root) {
  try {
    const session = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).session || {};
    return {
      intervalMs: Number.isFinite(session.refreshIntervalMinutes) && session.refreshIntervalMinutes >= 1 ? session.refreshIntervalMinutes * 60 * 1000 : 50 * 60 * 1000,
      delayMs: Number.isFinite(session.reloadDelaySeconds) && session.reloadDelaySeconds >= 0 ? session.reloadDelaySeconds * 1000 : 60 * 1000
    };
  } catch { return { intervalMs: 50 * 60 * 1000, delayMs: 60 * 1000 }; }
}

class SessionRefresher {
  constructor({ root = path.join(__dirname, ".."), onToken, onSession, onError = () => {}, spawnImpl = spawn, readFileSync = fs.readFileSync } = {}) {
    this.root = root;
    this.onToken = onToken;
    this.onSession = onSession;
    this.onError = onError;
    this.spawn = spawnImpl;
    this.readFileSync = readFileSync;
    this.sessionFile = path.join(root, "session.json");
    this.refreshScript = path.join(root, "refresh.js");
    Object.assign(this, settings(root));
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.load();
    this.run();
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => this.run(), ms);
    this.timer.unref?.();
  }

  run() {
    if (this.stopped || this.child) return;
    this.lastAttempt = Date.now();
    clearTimeout(this.timer);
    let finished = false;
    const finish = success => {
      if (finished) return;
      finished = true;
      this.child = null;
      if (this.stopped) return;
      if (success) {
        // Adopt the new bearer immediately, before the next playback poll.
        this.load();
        clearTimeout(this.delay);
        this.delay = setTimeout(() => this.load(), this.delayMs);
        this.delay.unref?.();
        const untilExpiry = this.expires - Date.now() - 120000;
        this.schedule(Number.isFinite(untilExpiry) ? Math.max(60000, Math.min(this.intervalMs, untilExpiry)) : this.intervalMs);
      } else {
        this.onError("session-refresh-failed");
        this.schedule(60000);
      }
    };
    try {
      this.child = this.spawn(process.execPath, [this.refreshScript], { cwd: this.root, shell: false, stdio: "ignore", windowsHide: true, timeout: 45000 });
      this.child.once("error", () => finish(false));
      this.child.once("close", code => finish(code === 0));
    } catch { finish(false); }
  }

  requestRefresh() {
    if (!this.lastAttempt || Date.now() - this.lastAttempt >= 60000) this.run();
  }

  load() {
    try {
      const session = JSON.parse(this.readFileSync(this.sessionFile, "utf8"));
      this.expires = Number(session.SPOTIFY_WEB_TOKEN_EXPIRES_AT) || undefined;
      this.onSession?.(session);
      const token = session.SPOTIFY_WEB_TOKEN;
      const clean = typeof token === "string" ? token.replace(/^Bearer\s+/i, "").trim() : "";
      if (clean && !/\s/.test(clean)) this.onToken?.(clean);
    } catch {}
  }

  stop() {
    this.stopped = true;
    this.started = false;
    clearTimeout(this.timer);
    clearTimeout(this.delay);
    this.child?.kill();
  }
}

module.exports = { SessionRefresher, settings };
