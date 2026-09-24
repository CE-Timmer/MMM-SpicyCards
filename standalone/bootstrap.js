// Upstream stores require only this storage interface from Spicetify.
// It lives inside an isolated iframe, never on the MagicMirror window.
globalThis.Spicetify = {
  LocalStorage: {
    get(key) { try { return localStorage.getItem(`SpotifyCards:${key}`); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(`SpotifyCards:${key}`, value); } catch {} }
  },
  Tippy(element, options) {
    if (typeof options.content === "string") element.title = options.content;
    return { destroy() { element.removeAttribute("title"); }, setContent(text) { element.title = text; } };
  }
};
