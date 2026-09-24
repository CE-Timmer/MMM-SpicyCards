/* global window, document */
(function () {
  "use strict";
  class SpotifyCardsView {
    constructor(root, options = {}, source = "standalone/index.html") {
      this.root = root;
      this.options = options;
      this.root.className = "spotify-cards-host";
      this.root.style.setProperty("--card-width", `${Math.max(240, Number(options.width) || 720)}px`);
      this.root.style.setProperty("--card-height", `${Math.max(180, Number(options.height) || 330)}px`);
      this.root.style.setProperty("--portrait-width", `${Math.max(260, Number(options.fullscreenWidth) || 440)}px`);
      this.root.classList.toggle("portrait", options.layout === "vertical");
      this.frame = document.createElement("iframe");
      this.frame.title = "Spicy Lyrics · SpotifyCards";
      this.frame.src = source;
      this.root.append(this.frame);
      this.pending = new Map();
      this.handler = event => {
        if (event.source !== this.frame.contentWindow || event.origin !== location.origin || !event.data?.spotifyCards) return;
        if (event.data.type === "ready") {
          this.ready = true;
          this.send("config", this.options);
          for (const [type, data] of this.pending) this.send(type, data);
          this.send("fullscreen", !!this.fullscreen);
        } else if (event.data.type === "toggle-fullscreen") this.toggleFullscreen();
      };
      window.addEventListener("message", this.handler);
      this.keyHandler = e => { if (e.key === "Escape" && this.fullscreen) this.toggleFullscreen(); };
      document.addEventListener("keydown", this.keyHandler);
    }
    send(type, data) {
      if (type === "suspend") this.pending.delete("resume");
      if (type === "resume") this.pending.delete("suspend");
      if (type !== "config") this.pending.set(type, data);
      if (!this.ready) return;
      this.frame.contentWindow.postMessage({ spotifyCards: true, type, data }, location.origin);
    }
    setPlayback(data) {
      if (this.pending.get("playback")?.track?.id !== data.track?.id) this.pending.delete("lyrics");
      this.pending.delete("error");
      this.send("playback", data);
    }
    setLyrics(data) { this.send("lyrics", data); }
    setError(code) { this.send("error", { code }); }
    suspend() { this.send("suspend"); }
    resume() { this.send("resume"); }
    toggleFullscreen() {
      this.fullscreen = !this.fullscreen;
      if (this.fullscreen) {
        this.placeholder = document.createComment("spotify-card");
        this.root.replaceWith(this.placeholder);
        document.body.append(this.root);
      } else this.placeholder.replaceWith(this.root);
      this.root.classList.toggle("fullscreen", this.fullscreen);
      this.send("fullscreen", this.fullscreen);
      this.frame.focus();
    }
    destroy() {
      if (this.fullscreen) this.toggleFullscreen();
      window.removeEventListener("message", this.handler);
      document.removeEventListener("keydown", this.keyHandler);
      this.frame.remove();
    }
  }
  window.SpotifyCardsView = SpotifyCardsView;
})();
