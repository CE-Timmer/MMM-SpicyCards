/* global Module, SpotifyCardsView */
Module.register("MMM-SpotifyCards", {
  defaults: { width: 720, height: 330, fullscreenWidth: 440, pollInterval: 3000,
    lyricsOffset: 0, showTransliteration: false, layout: "horizontal" },
  getStyles() { return ["SpotifyCards.css"]; },
  getScripts() { return ["card-view.js"]; },
  start() {
    this.ready = false;
  },
  getDom() {
    if (!this.root) {
      this.root = document.createElement("div");
      this.view = new SpotifyCardsView(this.root, this.config, this.file("standalone/index.html"));
    }
    return this.root;
  },
  notificationReceived(notification) {
    if (notification === "DOM_OBJECTS_CREATED") {
      this.ready = true;
      this.sendSocketNotification("SPOTIFYCARDS_SUBSCRIBE", {
        instanceId: this.identifier, pollInterval: this.config.pollInterval
      });
    }
  },
  socketNotificationReceived(notification, payload) {
    if (payload?.instanceId !== this.identifier) return;
    if (!this.view) this.getDom();
    if (notification === "SPOTIFYCARDS_PLAYBACK") this.view.setPlayback(payload);
    if (notification === "SPOTIFYCARDS_LYRICS") this.view.setLyrics(payload);
    if (notification === "SPOTIFYCARDS_ERROR") this.view.setError(payload.code);
  },
  suspend() { this.view?.suspend(); },
  resume() { this.view?.resume(); }
});
