"use strict";
const { SLObjPack } = require("../vendor/objpack");
const codec = new SLObjPack({ limits: { depth: 64, arrayLength: 10000, objectKeys: 1000,
  streamLength: 500000, valuesLength: 100000, decodeOps: 100000 } });

function decodeLyrics(payload) {
  const raw = Array.isArray(payload) ? codec.unpack(payload) : payload;
  if (!raw || !["Static", "Line", "Syllable"].includes(raw.Type)) throw new Error("Unsupported lyrics format");
  const content = raw.Type === "Static" ? raw.Lines : raw.Content;
  if (!Array.isArray(content)) throw new Error("Missing lyrics content");
  // The entire payload reaches the upstream renderer without a conversion to
  // another lyric model. Unknown metadata and timing fields are preserved too.
  return { raw, hasLyrics: content.length > 0 };
}
module.exports = { decodeLyrics };
