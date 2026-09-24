"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".map": "application/json" };
function createPreviewServer() {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/favicon.ico") { res.writeHead(204).end(); return; }
    const file = pathname === "/" ? "preview/index.html" : pathname.slice(1);
    if (!/^(preview\/|dist\/|standalone\/index\.html$|card-view\.js$|SpotifyCards\.css$)/.test(file) || file.includes("..")) { res.writeHead(404).end(); return; }
    try { const body = await fs.readFile(path.join(root, file)); res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(body); }
    catch { res.writeHead(404).end("Not found. Run npm run build first."); }
  });
}
if (require.main === module) createPreviewServer().listen(8099, "127.0.0.1", () => console.log("Card preview: http://127.0.0.1:8099 (synthetic demo data)"));
module.exports = { createPreviewServer };
