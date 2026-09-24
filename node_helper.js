"use strict";
const NodeHelper = require("node_helper");
const { SpotifyService } = require("./lib/service");
const { SessionRefresher } = require("./lib/session-refresher");
const { startDesktopBridge } = require("./lib/desktop-bridge");

module.exports = NodeHelper.create({
  start() {
    this.service = new SpotifyService();
    this.sessionRefresher = new SessionRefresher({
      onToken: token => this.service.setWebPlayerToken(token),
      onSession: session => this.service.setSessionCredentials(session),
      onError: code => console.warn(`[MMM-SpotifyCards] ${code}: check config.json sp_dc and the token helper; retrying in one minute.`)
    });
    this.sessionRefresher.start();
    this.clients = new Set();
    this.pollIntervals = new Map();
    this.interval = 3000;
    this.stopped = false;
    this.currentId = null;
    this.lyricAttempt = null;
    this.lyricsRetry = 0;
    this.desktopBridge = startDesktopBridge({
      credentialFile: this.service.credentialFile,
      onToken: () => { this.lyricsRetry = 0; },
      onError: code => console.warn(`[MMM-SpotifyCards] Desktop bridge: ${code}`),
      onListening: (host, port) => console.log(`[MMM-SpotifyCards] Desktop bridge listening on ${host}:${port}`)
    });
  },
  socketNotificationReceived(notification, payload) {
    if (notification !== "SPOTIFYCARDS_SUBSCRIBE" || typeof payload?.instanceId !== "string") return;
    this.clients.add(payload.instanceId);
    const interval = Number(payload.pollInterval);
    this.pollIntervals.set(payload.instanceId, Number.isFinite(interval) ? Math.max(2000, interval) : 3000);
    this.interval = Math.min(...this.pollIntervals.values());
    if (this.latest) this.broadcast("SPOTIFYCARDS_PLAYBACK", this.latest);
    if (this.latestLyrics) this.broadcast("SPOTIFYCARDS_LYRICS", this.latestLyrics);
    if (!this.running) { this.running = true; this.poll(); }
  },
  broadcast(notification, data) {
    if (this.stopped) return;
    for (const instanceId of this.clients) this.sendSocketNotification(notification, { ...data, instanceId });
  },
  async poll() {
    let delay = this.interval;
    try {
      this.sessionRefresher?.load();
      const playback = await this.service.playback();
      if (this.stopped) return;
      this.latest = playback;
      this.broadcast("SPOTIFYCARDS_PLAYBACK", playback);
      const id = playback.track?.lyricsId || null;
      if (id !== this.currentId) {
        this.currentId = id;
        this.lyricAttempt = null;
        this.lyricsRetry = 0;
        this.latestLyrics = null;
      }
      if (id && !this.lyricAttempt && Date.now() >= this.lyricsRetry) this.fetchLyrics(id);
    } catch (error) {
      if (error.code === "playback-auth") this.sessionRefresher?.requestRefresh();
      delay = Math.max(this.interval, error.retryMs || 30000);
      this.broadcast("SPOTIFYCARDS_ERROR", { code: error.code || "playback-unavailable" });
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => this.poll(), delay);
    }
  },
  async fetchLyrics(id) {
    const attempt = {};
    this.lyricAttempt = attempt;
    try {
      const lyrics = await this.service.lyrics(id);
      if (this.stopped || this.currentId !== id || this.lyricAttempt !== attempt) return;
      this.latestLyrics = { trackId: id, lyrics: lyrics?.hasLyrics ? lyrics : null, code: lyrics?.hasLyrics ? "ready" : "lyrics-not-found" };
      this.lyricsRetry = Date.now() + (lyrics ? 3600000 : 300000);
      this.broadcast("SPOTIFYCARDS_LYRICS", this.latestLyrics);
    } catch (error) {
      if (this.stopped || this.currentId !== id || this.lyricAttempt !== attempt) return;
      if (error.code === "lyrics-auth") this.sessionRefresher?.requestRefresh();
      this.lyricsRetry = Date.now() + (error.retryMs || 30000);
      this.latestLyrics = { trackId: id, lyrics: null, code: error.code || "lyrics-unavailable" };
      this.broadcast("SPOTIFYCARDS_LYRICS", this.latestLyrics);
    } finally {
      if (this.lyricAttempt === attempt) this.lyricAttempt = null;
    }
  },
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.sessionRefresher?.stop();
    this.desktopBridge?.close();
    this.desktopBridge?.closeAllConnections();
  }
});
