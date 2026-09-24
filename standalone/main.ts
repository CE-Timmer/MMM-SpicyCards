import { setPage, updatePlayback, SpotifyPlayer, setOffset, playback } from "./platform";
import { ApplySyllableLyrics } from "../upstream/spicy-lyrics/src/utils/Lyrics/Applyer/Synced/Syllable";
import { ApplyLineLyrics } from "../upstream/spicy-lyrics/src/utils/Lyrics/Applyer/Synced/Line";
import { ApplyStaticLyrics } from "../upstream/spicy-lyrics/src/utils/Lyrics/Applyer/Static";
import { DestroyAllLyricsContainers } from "../upstream/spicy-lyrics/src/utils/Lyrics/Applyer/CreateLyricsContainer";
import { ClearLyricsContentArrays } from "../upstream/spicy-lyrics/src/utils/Lyrics/lyrics";
import { ScrollToActiveLine, InitializeScrollEvents, ResetLastLine, CleanupScrollEvents } from "../upstream/spicy-lyrics/src/utils/Scrolling/ScrollToActiveLine";
import { ScrollSimplebar, ClearScrollSimplebar } from "../upstream/spicy-lyrics/src/utils/Scrolling/Simplebar/ScrollSimplebar";
import { CleanUpIsByCommunity } from "../upstream/spicy-lyrics/src/utils/Lyrics/Applyer/Credits/ApplyIsByCommunity";
import { $lyricsContainerExists, $currentLyricsType, $currentLyricsData, $simpleLyricsMode } from "../upstream/spicy-lyrics/src/utils/stores";
import "simplebar/dist/simplebar.css";
import "../upstream/spicy-lyrics/src/css/Lyrics/main.css";
import "../upstream/spicy-lyrics/src/css/Lyrics/Mixed.css";
import "../upstream/spicy-lyrics/src/css/Simplebar.css";
import "./cards.css";

const page = document.getElementById("SpicyLyricsPage")!;
let rawLyrics: any = null;
let options: any = {};
let fullscreen = false;
let suspended = false;
let ready = false;
const messages: Record<string, string> = {
  "playback-setup": "Connect Spotify to start listening",
  "credentials-invalid": "Check the server credentials file",
  "playback-auth": "Reconnect Spotify playback",
  "playback-rate-limited": "Spotify will reconnect shortly",
  "playback-unavailable": "Reconnecting to Spotify…",
  "lyrics-setup": "Add a web-player token to load lyrics",
  "lyrics-auth": "Refresh your web-player token for lyrics",
  "lyrics-queued": "Spicy Lyrics is preparing this song…",
  "lyrics-rate-limited": "Lyrics will retry shortly…",
  "lyrics-unavailable": "Lyrics are temporarily unavailable",
  "lyrics-format": "Unsupported lyrics response",
  "lyrics-not-found": "No lyrics for this song"
};
function clear() {
  $lyricsContainerExists.set(false);
  $currentLyricsType.set("None");
  CleanupScrollEvents();
  DestroyAllLyricsContainers();
  ClearScrollSimplebar();
  ClearLyricsContentArrays();
  CleanUpIsByCommunity();
  page.querySelector(".LyricsContent")!.replaceChildren();
  ResetLastLine();
}
function notice(text: string) {
  clear();
  const el = document.createElement("p");
  el.className = "CardNotice";
  el.textContent = text;
  el.setAttribute("role", "status");
  page.querySelector(".LyricsContent")!.append(el);
}
function apply() {
  if (!rawLyrics) return;
  clear();
  // Upstream may mutate display data; keep the complete original response intact.
  const data = structuredClone(rawLyrics);
  $currentLyricsData.set(JSON.stringify(rawLyrics));
  $currentLyricsType.set(data.Type);
  $lyricsContainerExists.set(true);
  const romanized = !!options.showTransliteration;
  try {
    if (data.Type === "Syllable") ApplySyllableLyrics(data, romanized);
    else if (data.Type === "Line") ApplyLineLyrics(data, romanized);
    else if (data.Type === "Static") ApplyStaticLyrics(data, romanized);
    else { notice(messages["lyrics-format"]); return; }
    InitializeScrollEvents(ScrollSimplebar);
    if (suspended) $lyricsContainerExists.set(false);
  } catch (error) {
    console.error("Unable to render Spicy Lyrics", error);
    notice(messages["lyrics-format"]);
  }
}
function metadata(data: any) {
  const title = page.querySelector(".SongName span")!;
  const artist = page.querySelector(".Artists span")!;
  title.textContent = data.track?.title || "Nothing playing";
  artist.textContent = data.track?.artist || "";
  const cover = page.querySelector<HTMLElement>(".MediaImageContainer")!;
  cover.replaceChildren();
  if (data.track?.cover && (/^https:\/\//.test(data.track.cover) || data.track.cover.startsWith(`${location.origin}/preview/`))) {
    const img = document.createElement("img");
    img.src = data.track.cover;
    img.alt = "Album cover";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => img.remove();
    cover.append(img);
    page.style.setProperty("--card-artwork", `url(${JSON.stringify(data.track.cover)})`);
  } else page.style.removeProperty("--card-artwork");
}
function layout(vertical: boolean) {
  page.classList.toggle("Fullscreen", vertical);
  page.classList.toggle("CardVertical", vertical);
  requestAnimationFrame(() => { ScrollSimplebar?.recalculate(); ResetLastLine(); });
}
function send(type: string) { window.parent.postMessage({ spotifyCards: true, type }, location.origin); }
async function start() {
  const res = await fetch("../dist/page.html");
  if (!res.ok) throw new Error("Page template unavailable");
  page.innerHTML = await res.text();
  setPage(page);
  page.classList.add("SpicyRenderer", "SpotifyCard");
  const controls = page.querySelector(".ViewControls")!;
  const brand = document.createElement("span");
  brand.className = "CardBrand";
  brand.textContent = "◉  SPICY LYRICS";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "CardFullscreen";
  button.textContent = "⤢";
  button.setAttribute("aria-label", "Toggle fullscreen card");
  button.onclick = () => send("toggle-fullscreen");
  controls.append(brand, button);
  notice("Waiting for Spotify…");
  ready = true;
  send("ready");
  requestAnimationFrame(function tick() {
    if (!suspended && rawLyrics) ScrollToActiveLine(ScrollSimplebar);
    requestAnimationFrame(tick);
  });
}
window.addEventListener("message", event => {
  if (event.source !== window.parent || event.origin !== location.origin || !event.data?.spotifyCards || !ready) return;
  const { type, data } = event.data;
  if (type === "config") {
    options = data || {};
    setOffset(options.lyricsOffset);
    $simpleLyricsMode.set(matchMedia("(prefers-reduced-motion: reduce)").matches);
    layout(fullscreen || options.layout === "vertical");
  } else if (type === "playback") {
    const changed = playback?.track?.id !== data.track?.id;
    updatePlayback(data);
    page.querySelector(".CardBrand")!.textContent = "◉  SPICY LYRICS";
    if (changed || !data.track) {
      rawLyrics = null;
      metadata(data);
      notice(data.track ? (data.track.lyricsId ? "Finding the words…" : "Lyrics aren’t available for this audio") : "Nothing playing. Put on something you love.");
    }
    page.classList.toggle("Paused", !data.playing);
  } else if (type === "lyrics") {
    if (data.trackId !== playback?.track?.lyricsId) return;
    rawLyrics = data.lyrics?.raw || null;
    if (rawLyrics) apply();
    else notice(messages[data.code] || messages["lyrics-not-found"]);
  } else if (type === "error") {
    const progress = SpotifyPlayer.GetPosition() - (Number(options.lyricsOffset) || 0);
    if (playback) updatePlayback({ ...playback, progress, playing: false });
    if (!rawLyrics) notice(messages[data.code] || messages["playback-unavailable"]);
    else page.querySelector(".CardBrand")!.textContent = messages[data.code] || messages["playback-unavailable"];
  } else if (type === "fullscreen") {
    fullscreen = !!data;
    layout(fullscreen || options.layout === "vertical");
    page.querySelector(".CardFullscreen")!.textContent = fullscreen ? "×" : "⤢";
  } else if (type === "suspend") { suspended = true; $lyricsContainerExists.set(false); }
  else if (type === "resume") { suspended = false; if (rawLyrics) $lyricsContainerExists.set(true); }
});
document.addEventListener("keydown", event => { if (event.key === "Escape" && fullscreen) send("toggle-fullscreen"); });
start().catch(error => { page.textContent = "Unable to load Spicy Lyrics. Run npm run build."; console.error(error); });
