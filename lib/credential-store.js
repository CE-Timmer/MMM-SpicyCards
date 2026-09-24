"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

async function saveCredentials(filename, patch) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(filename, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("credentials-invalid"); }
  const temporary = `${filename}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ ...previous, ...patch }, null, 2), { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, filename);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}
module.exports = { saveCredentials };
