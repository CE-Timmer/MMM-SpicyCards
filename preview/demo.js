const id = "0123456789abcdefghijkl";
const lines = ["Let the room turn into color", "Let the quiet find its voice", "Every light across the water", "Moves in time with every choice", "Leave the hurry at the doorway", "Watch the evening settle in", "There is music in the silence", "And a place for us within"];
window.demoPayload = type => {
  if (type === "Static") return { Type: type, Lines: lines.map(Text => ({ Text })), SongWriters: ["SpotifyCards demo"], source: "spl" };
  const Content = lines.map((Text, index) => {
    const StartTime = 2 + index * 7, EndTime = StartTime + 5.7;
    if (type === "Line") return { Type: "Vocal", Text, StartTime, EndTime, OppositeAligned: index === 3 };
    const words = Text.split(" ");
    return { Type: "Vocal", OppositeAligned: index === 3, Lead: { StartTime, EndTime, Syllables: words.map((Text, j) => ({ Text, StartTime: StartTime + j * .7, EndTime: StartTime + (j + 1) * .7, IsPartOfWord: false })) }, ...(index === 2 ? { Background: [{ StartTime: StartTime + 2, EndTime, Syllables: [{ Text: "Across the water", StartTime: StartTime + 2, EndTime, IsPartOfWord: false }] }] } : {}) };
  });
  return { Type: type, Content, StartTime: 2, EndTime: 60, SongWriters: ["SpotifyCards demo"], source: "spl", preservedExample: { untouched: true } };
};
window.card = new SpotifyCardsView(document.getElementById("card"), { width: 720, height: 330, fullscreenWidth: 440 }, "/standalone/index.html");
let playing = true, position = 7000, last = performance.now();
function playback() {
  card.setPlayback({ track: { id, lyricsId: id, title: "The Quiet Hours", artist: "Lumen Collective", duration: 60000,
    cover: `${location.origin}/preview/cover.svg` }, playing, progress: position, observedAt: Date.now() });
}
function lyrics() { const type = document.getElementById("type").value; card.setLyrics({ trackId: id, lyrics: type === "No lyrics" ? null : { raw: demoPayload(type) }, code: type === "No lyrics" ? "lyrics-not-found" : "ready" }); }
playback(); lyrics();
document.getElementById("pause").onclick = () => { playing = !playing; document.getElementById("pause").textContent = playing ? "Pause" : "Play"; playback(); };
document.getElementById("seek").oninput = event => { position = Number(event.target.value); playback(); };
document.getElementById("type").onchange = lyrics;
document.getElementById("portrait").onclick = () => card.toggleFullscreen();
setInterval(() => { const now = performance.now(); if (playing) position = (position + now - last) % 60000; last = now; document.getElementById("seek").value = position; playback(); }, 1000);
