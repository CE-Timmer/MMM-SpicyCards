/* SpotifyCards desktop session relay. No Spotify token is stored in localStorage. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else api.boot(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const STORAGE_KEY = "spotifycards-desktop-bridge-v1";

  function normalizeConfig(input) {
    const raw = String(input.url || "").trim();
    const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Enter an HTTP(S) mirror address without credentials or query parameters.");
    const pairingKey = String(input.pairingKey || "").trim();
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(pairingKey)) throw new Error("Paste the pairing key printed by npm run bridge on the mirror.");
    return { url: url.href.replace(/\/+$/, ""), pairingKey, enabled: !!input.enabled };
  }

  function usable(value, now) {
    const accessToken = value?.accessToken;
    const expiresAt = value?.accessTokenExpirationTimestampMs ?? value?.expiresAtTime;
    if (value?.isAnonymous || typeof accessToken !== "string" || accessToken.length < 20 || accessToken.length > 8192 || /\s/.test(accessToken)) return null;
    if (!Number.isFinite(expiresAt) || expiresAt <= now + 60000 || expiresAt > now + 86400000) return null;
    return { accessToken, expiresAt };
  }

  async function readDesktopSession(spicetify, now = Date.now()) {
    // Match Spicy Lyrics' Platform.ts sources; no cookies or browser scraping.
    let state;
    try { state = spicetify.Platform?.AuthorizationAPI?.getState(); } catch {}
    if (state?.isAuthorized === false || state?.token?.isAnonymous) throw new Error("Sign in to Spotify desktop first.");
    const current = usable(state?.token, now);
    if (current) return current;
    try {
      const legacy = usable(await spicetify.CosmosAsync.get("sp://oauth/v2/token"), now);
      if (legacy) return legacy;
    } catch {}
    const session = usable(spicetify.Platform?.Session, now);
    if (session) return session;
    throw new Error("Waiting for Spotify desktop to provide a fresh session token.");
  }

  function createBridge({ spicetify, fetchImpl = fetch, now = Date.now, onStatus = () => {} }) {
    let config = null, generation = 0, busy = false, lastToken = "", lastSent = 0;
    let failures = 0, nextCheck = 0, controller;
    let status = "Configure your mirror address and pairing key.";
    function report(message) { status = message; onStatus(message); }
    function configure(input) {
      const next = normalizeConfig(input);
      controller?.abort();
      config = next; generation++; nextCheck = 0; failures = 0; lastToken = ""; lastSent = 0;
      report(config.enabled ? "Ready to send the desktop session." : "Token forwarding is disabled.");
      return config;
    }
    async function tick(force = false) {
      if (!config?.enabled || busy || (!force && now() < nextCheck)) return;
      busy = true;
      const revision = generation, target = { ...config };
      let deadline;
      try {
        const session = await Promise.race([
          readDesktopSession(spicetify, now()),
          new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Spotify session lookup timed out.")), 12000); })
        ]);
        clearTimeout(deadline);
        if (revision !== generation) return;
        if (!force && session.accessToken === lastToken && now() - lastSent < 300000) {
          nextCheck = now() + 30000; return;
        }
        controller = new AbortController();
        deadline = setTimeout(() => controller.abort(), 10000);
        const response = await fetchImpl(`${target.url}/spotifycards/token`, {
          method: "POST", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-SpotifyCards-Key": target.pairingKey },
          body: JSON.stringify(session)
        });
        if (revision !== generation) return;
        if (!response.ok) {
          const message = response.status === 401 ? "Pairing key was rejected. Check the key on both devices."
            : response.status === 404 ? "Receiver not found. Check the mirror address and bridge port."
            : response.status === 400 ? "Session rejected. Check both devices' clocks and Spotify login."
            : `Mirror returned HTTP ${response.status}.`;
          throw new Error(message);
        }
        const result = await response.json();
        if (revision !== generation) return;
        if (result.ok !== true) throw new Error("The address did not return a SpotifyCards acknowledgement.");
        lastToken = session.accessToken; lastSent = now(); failures = 0; nextCheck = now() + 30000;
        report(`Session delivered at ${new Date(lastSent).toLocaleTimeString()}. Spotify expiry: ${new Date(session.expiresAt).toLocaleTimeString()}.`);
      } catch (error) {
        if (revision === generation) {
          failures++; const retry = Math.min(300000, 30000 * 2 ** Math.min(failures - 1, 4));
          nextCheck = now() + retry;
          // Network errors may contain URLs. Never echo request objects or tokens.
          const message = error instanceof TypeError || error.name === "AbortError"
            ? "Cannot reach the mirror. Check its IP, port, firewall, and HTTP/HTTPS access."
            : error.message;
          report(`${message} Retrying in ${retry / 1000} seconds.`);
        }
      } finally { clearTimeout(deadline); busy = false; }
    }
    function stop() { controller?.abort(); generation++; config = null; lastToken = ""; }
    return { configure, tick, stop, status: () => status };
  }

  function boot(root) {
    if (root.__spotifyCardsBridgeLoaded) return;
    root.__spotifyCardsBridgeLoaded = true;
    const initialize = () => {
      const sp = root.Spicetify;
      if (!sp?.Platform || !sp?.Menu?.Item || !sp?.PopupModal || !sp?.LocalStorage) { setTimeout(initialize, 1000); return; }
      let statusElement;
      const bridge = createBridge({ spicetify: sp, onStatus: text => { if (statusElement) statusElement.textContent = text; } });
      let saved = { url: "http://127.0.0.1:8890", pairingKey: "", enabled: true };
      try {
        const stored = sp.LocalStorage.get(STORAGE_KEY);
        if (stored) { saved = normalizeConfig(JSON.parse(stored)); bridge.configure(saved); }
      } catch {}
      function settings() {
        const content = document.createElement("form");
        content.style.cssText = "display:grid;gap:16px;padding:8px;min-width:280px";
        function field(text, type, value) {
          const label = document.createElement("label"), input = document.createElement("input");
          label.textContent = text; label.style.cssText = "display:grid;gap:6px";
          input.type = type; input.value = value; input.style.cssText = "padding:10px;border:1px solid #777;border-radius:6px;background:#242424;color:white;width:100%;box-sizing:border-box";
          label.append(input); content.append(label); return input;
        }
        const url = field("Mirror address (include bridge port)", "text", saved.url);
        url.placeholder = "http://192.168.1.50:8890"; url.required = true;
        const key = field("Pairing key", "password", saved.pairingKey);
        key.autocomplete = "off"; key.required = true;
        const enabledLabel = document.createElement("label"), enabled = document.createElement("input");
        enabled.type = "checkbox"; enabled.checked = saved.enabled;
        enabledLabel.append(enabled, document.createTextNode(" Forward desktop session to this mirror")); content.append(enabledLabel);
        const note = document.createElement("p");
        note.textContent = "Keep Spotify running to forward renewed tokens. Use HTTP on a trusted LAN, or HTTPS through your reverse proxy.";
        note.style.cssText = "font-size:13px;line-height:1.5"; content.append(note);
        statusElement = document.createElement("p"); statusElement.setAttribute("role", "status"); statusElement.textContent = bridge.status(); content.append(statusElement);
        const save = document.createElement("button"); save.type = "submit"; save.textContent = "Save and send now";
        save.style.cssText = "padding:12px;border:0;border-radius:20px;background:#1ed760;color:#000;font-weight:bold"; content.append(save);
        content.onsubmit = async event => {
          event.preventDefault();
          try {
            const next = normalizeConfig({ url: url.value, pairingKey: key.value, enabled: enabled.checked });
            sp.LocalStorage.set(STORAGE_KEY, JSON.stringify(next));
            saved = bridge.configure(next);
            save.disabled = true;
            await bridge.tick(true);
          } catch (error) { statusElement.textContent = error.message; }
          finally { save.disabled = false; }
        };
        sp.PopupModal.display({ title: "SpotifyCards Bridge", content });
      }
      new sp.Menu.Item("SpotifyCards Bridge", false, settings).register();
      const interval = setInterval(() => { void bridge.tick(); }, 5000);
      void bridge.tick();
      root.addEventListener("beforeunload", () => { clearInterval(interval); bridge.stop(); });
    };
    initialize();
  }
  return { normalizeConfig, readDesktopSession, createBridge, boot };
});
