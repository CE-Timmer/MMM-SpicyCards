"use strict";
const $ = id => document.getElementById(id);
let csrf, polling = false;
const states = {
  idle: "The login window opens on this computer. Your password is entered only on Spotify.",
  opening: "Opening Spotify Web Player…",
  waiting: "Sign in in the Spotify window. If you are already signed in, open a song to trigger a player request.",
  saving: "Saving your web-player token…", saved: "Web-player token saved. Your cards will pick it up on their next retry.",
  cancelled: "Login closed. You can start again whenever you’re ready.",
  "timed-out": "Login timed out after five minutes. Start again to retry.",
  "browser-unavailable": "Couldn’t open a browser. Install Chrome/Edge, or run npx playwright install chromium. This computer needs a graphical desktop. You can also paste a token below.",
  "navigation-failed": "Couldn’t open Spotify. Check your connection and try again.",
  "save-failed": "Couldn’t save the token. Check access to your credentials file and retry.",
  "environment-override": "SPOTIFY_WEB_PLAYER_TOKEN overrides this file. Remove that variable from the setup and MagicMirror processes to use browser login."
};
const errors = { "invalid-token": "Paste a complete web-player bearer token.", "token-not-accepted": "Spotify did not accept this token. Sign in again and use a fresh token.", "invalid-client-id": "Enter the 32-character Spotify app client ID.", "environment-override": "Environment credentials override this connection. Remove the relevant SPOTIFY variables and restart setup to manage it here.", "credentials-invalid": "The existing credentials file is not valid JSON. Fix it before saving." };
async function post(endpoint, data = {}) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Setup-CSRF": csrf }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error] || "Setup couldn’t complete that action. Please try again.");
  return result;
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error("Setup is unavailable. Check the terminal and reload this page.");
    const status = await response.json(); csrf = status.csrf;
    for (const [id, configured] of [["lyrics-status", status.webTokenConfigured], ["playback-status", status.playbackConfigured]]) {
      $(id).textContent = configured ? "Configured" : "Not connected"; $(id).classList.toggle("connected", configured);
    }
    if (!$('client-id').value && status.clientId) $('client-id').value = status.clientId;
    $("redirect").textContent = status.redirectUri;
    $("playback-mode").textContent = { "refresh-token": "Using your separate Spotify app authorization with automatic playback token refresh.", "access-token": "Using your supplied playback access token. Replace it when it expires.", "web-session": "Using your saved Web Player session for playback. No developer app required. Reconnect Web Player when the session token expires." }[status.playbackMode] || "The cards can use your saved Web Player session for playback too. No developer app is needed for that route; Spotify must accept the session for playback access.";
    const busy = ["opening", "waiting", "saving"].includes(status.login.state);
    $("web-login").disabled = busy || status.webTokenEnvironment;
    $("cancel").hidden = !busy;
    $("login-state").textContent = states[status.webTokenEnvironment ? "environment-override" : status.login.state] || states.idle;
  } catch (error) { $("feedback").textContent = error.message; } finally { polling = false; }
}
async function action(fn) { $("feedback").textContent = ""; try { await fn(); await refresh(); } catch (error) { $("feedback").textContent = error.message; } }
$("web-login").onclick = () => action(() => post("/api/web-login"));
$("cancel").onclick = () => action(() => post("/api/cancel"));
$("token-form").onsubmit = event => { event.preventDefault(); action(async () => { await post("/api/token", { token: $("token").value }); $("token").value = ""; $("feedback").textContent = "Token saved. Your cards will pick it up on their next retry."; }); };
$("playback-form").onsubmit = event => { event.preventDefault(); action(async () => { const result = await post("/api/playback-login", { clientId: $("client-id").value.trim() }); location.assign(result.url); }); };
const result = new URLSearchParams(location.search).get("result");
if (result) { $("feedback").textContent = { connected: "Spotify playback connected.", declined: "Spotify authorization was declined. You can try again below.", failed: "Spotify authorization failed. Check your app settings and try again." }[result] || ""; history.replaceState(null, "", "/"); }
refresh(); setInterval(refresh, 1500);
