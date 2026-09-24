// Host boundary for the upstream renderer. No Spotify desktop globals or tokens.
export let PageContainer: HTMLElement | null = null;
export function setPage(page: HTMLElement) { PageContainer = page; }
export const IsPIP = false;
export const IsCompactMode = () => false;
export function ClearLyricsPageContainer() {
  PageContainer?.querySelector(".LyricsContent")?.replaceChildren();
}
export let playback: any = null;
let anchor = 0;
let progress = 0;
let offset = 0;
export function updatePlayback(value: any) {
  playback = value;
  anchor = performance.now();
  progress = value.progress || 0;
}
export function setOffset(value: number) { offset = Number(value) || 0; }
export const SpotifyPlayer = {
  get IsPlaying() { return !!playback?.playing; },
  GetPosition: () => Math.max(0, Math.min(playback?.track?.duration || 0,
    progress + (playback?.playing ? Math.min(15000, performance.now() - anchor) : 0))) + offset,
  GetDuration: () => playback?.track?.duration || 0,
  GetUri: () => playback?.track?.lyricsId ? `spotify:track:${playback.track.lyricsId}` : playback?.track?.id,
  Seek: (_position: number) => { /* Read-only display; no playback-control scope requested. */ }
};
