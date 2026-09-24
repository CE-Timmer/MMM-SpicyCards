"use strict";
const { createSetupServer } = require("../lib/setup-server");
const server = createSetupServer();
const port = Number(process.env.SPOTIFYCARDS_SETUP_PORT || 8888);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("SPOTIFYCARDS_SETUP_PORT must be a valid local port");
server.listen(port, "127.0.0.1", () => console.log(`SpotifyCards setup: http://127.0.0.1:${port}\nOpen this page on the same computer. Spotify login opens a dedicated browser window.`));
server.on("error", error => { console.error(error.code === "EADDRINUSE" ? `Port ${port} is in use. Close the other setup/auth command and retry.` : "Could not start the setup server."); process.exitCode = 1; });
async function stop() { await server.closeLogin(); server.close(); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
