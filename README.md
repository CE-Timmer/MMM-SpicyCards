# MMM-SpotifyCards

MagicMirror² cards built from the **actual Spicy Lyrics source**, running without
Spotify Desktop or Spicetify installed.

- **Normal page:** a horizontal lyrics-only card.
- **Fullscreen:** a vertical card with the existing cover, song name, and artist
  block stacked above the lyrics. Use the expand button; Escape closes it.
- Original Spicy Lyrics syllable/letter animation, line and static rendering,
  duet alignment, background vocals, interludes, virtualized scrolling, and credits.
- Spotify Web API playback and the official Spicy Lyrics developer API for lyrics.
  Keys and tokens stay in the Node helper.

## Install

Node 20+ and a current MagicMirror installation are required.

```sh
cd ~/MagicMirror/modules
git clone --recurse-submodules https://github.com/CE-Timmer/MMM-SpicyCards.git MMM-SpotifyCards
cd MMM-SpotifyCards
npm ci
npm run build
```

For an existing clone, run `git submodule update --init --recursive` before building.
The submodule is pinned; updating the parent repository does not silently select
the newest Spicy Lyrics release.

Add this to MagicMirror's `config/config.js`:

```js
{
  module: "MMM-SpotifyCards",
  position: "bottom_bar",
  config: {
    width: 720,
    height: 330,
    fullscreenWidth: 440,
    pollInterval: 3000,
    lyricsOffset: 0,
    showTransliteration: false
  }
}
```

`lyricsOffset` is milliseconds; positive values advance the displayed lyrics.
`layout: "vertical"` can also show the portrait card directly in a mirror region.
All instances share the configured Spotify account but have isolated renderers.
Fullscreen fills the mirror/browser viewport; it does not change the OS window mode.

## Setup page: log in directly to Spotify Web Player

**For a Spotify Desktop session instead:** use the
[Spicetify desktop token bridge](spicetify/README.md). It forwards renewed desktop
tokens to this module, including to a different device running MagicMirror in
server mode. The destination IP/URL and port are configurable inside Spotify.

```sh
npm run setup
```

If port 8888 is occupied, run `SPOTIFYCARDS_SETUP_PORT=8889 npm run setup` on
Linux/macOS, or `$env:SPOTIFYCARDS_SETUP_PORT=8889; npm run setup` in PowerShell.

Open **http://127.0.0.1:8888** on the same computer. Click **Log in to Spotify Web
Player**. A dedicated browser window opens Spotify's real website; sign in there.
When the player makes an authenticated Spotify API request, the helper verifies
the token against Spotify and saves it privately. It does not read password fields
or ask for your password. If no token appears after login, open a song in Web Player.

This route needs **no developer dashboard, client ID, or Spotify desktop app**.
When separate playback credentials are absent, the helper also tries this web
session token with `/v1/me/player`. Access depends on Spotify accepting that token
for the endpoint. The setup badge says *Configured*, not that live lyrics or
playback have been verified.

The browser opens on the computer running `npm run setup`, so use a graphical
desktop there. On Windows it prefers an installed Opera/Opera GX, then tries Edge
and Chrome; other platforms try Chrome.
For bundled Chromium, run `npx playwright install chromium`. You can set
`SPOTIFYCARDS_BROWSER_PATH` to a browser executable or
`SPOTIFYCARDS_BROWSER_CHANNEL` to `chrome`/`msedge`.

The dedicated sign-in profile is saved alongside the private credentials file in
`web-player-profile/`. It does not use your normal browser profile. The window
closes once the token is saved; the page also provides cancellation and a manual
token field. The helper times out after five minutes. Setup is loopback-only and
must be opened with `127.0.0.1`, not a LAN hostname.

### Headless mirror setup

The browser-login button needs a graphical desktop, but the **manual token field
works on a headless mirror**. Run this on the mirror:

```sh
cd ~/MagicMirror/modules/MMM-SpotifyCards
npm run setup
```

From your laptop or desktop, make an SSH tunnel to that mirror:

```sh
ssh -L 8888:127.0.0.1:8888 MIRROR_USER@MIRROR_HOST
```

Then open `http://127.0.0.1:8888` in your own browser, expand **Already have a
web-player token?**, and paste it. The setup page is communicating through the
tunnel and saves it at `~/.config/MMM-SpotifyCards/credentials.json` on the
mirror. It never stores the token on your laptop or sends it over the LAN.

You can generate the web-player token on your desktop using the setup page’s
browser login, then use the headless page’s manual field to place it on the
mirror. Keep the SSH terminal open while using the page; press Ctrl+C on the
mirror when you are done.

For terminal-only provisioning, send a JSON object to standard input on the
mirror. This avoids putting a token in an argument or the process list:

```sh
printf '%s' '{"webPlayerToken":"PASTE_TOKEN_HERE"}' | npm run credentials
```

To copy a complete credential object securely, prefer `scp` to a temporary
permission-restricted file and pipe that file into the command, then remove the
temporary file. The accepted keys are `webPlayerToken`, `accessToken`,
`refreshToken`, `clientId`, and `clientSecret`.

Without a configured `sp_dc` cookie, when the token expires, click the login button again. The saved browser session
may let Spotify reconnect without entering your password again. This is an
on-demand reconnection, not an OAuth refresh token for the Web Player session.
The mirror rereads saved credentials on retry. Stop setup with Ctrl+C when done.

The page also offers an **optional separate playback authorization** using your
own developer app. This provides refreshable playback access independently of
the lyrics session. The command-line equivalent is below.

## Optional separate playback authorization

Create a Spotify developer app and add this exact redirect URI:

```text
http://127.0.0.1:8888/callback
```

Then, on a computer where you can open a browser:

```sh
npm run auth -- YOUR_SPOTIFY_CLIENT_ID
```

Open the printed authorization URL on that same computer. The PKCE flow requests
`user-read-playback-state`, saves a refresh token, and does not require a client
secret. If you authorize on another computer, copy the resulting credentials file
to the mirror user's path below. Playback refreshes automatically. An app-only
client-credentials token cannot read a user's currently playing song.

Default credentials file, **outside MagicMirror's served module directory**:

```text
~/.config/MMM-SpotifyCards/credentials.json
```

On Windows, `~` means your user home directory. The file will contain:

```json
{
  "clientId": "YOUR_SPOTIFY_CLIENT_ID",
  "refreshToken": "SAVED_BY_THE_AUTH_COMMAND",
  "webPlayerToken": "YOUR_SPOTIFY_WEB_PLAYER_ACCESS_TOKEN"
}
```

## Connect Spicy Lyrics

Create an application at [Spicy Lyrics for Developers](https://developers.spicylyrics.org/docs)
and obtain a **server key** (`sl_sk_...`). Put it in the private credentials file,
normally `~/.config/MMM-SpotifyCards/credentials.json`, as `spicyLyricsSecretKey`.
You can import it without placing the key on a command line:

```sh
printf '%s' '{"spicyLyricsSecretKey":"sl_sk_YOUR_KEY"}' | npm run credentials
```

The helper sends `GET https://api.spicylyrics.org/v1/lyrics/{trackId}` with the
key in the Authorization header. It passes the complete `Body` lyrics object to
the upstream renderer, including source and attribution data. This endpoint does
not use Spotify browser or desktop tokens. Keep the key out of `config.json`,
which is inside MagicMirror's served module directory. Key changes are read on
the next lyrics request; cached lyrics may remain for up to an hour.

Environment variables can override file values:

| Variable | Purpose |
| --- | --- |
| `SPOTIFYCARDS_CREDENTIAL_FILE` | Absolute path to an alternative private credentials file |
| `SPOTIFY_CLIENT_ID` | Client ID paired with the refresh token |
| `SPOTIFY_REFRESH_TOKEN` | User-authorized refresh token for automatic playback renewal |
| `SPOTIFY_CLIENT_SECRET` | Optional, for an existing confidential-client authorization |
| `SPOTIFY_ACCESS_TOKEN` | Short-lived **user** access token instead of refresh credentials |
| `SPOTIFY_WEB_PLAYER_TOKEN` | Browser session fallback for playback and legacy lyrics requests |
| `SPICY_LYRICS_SECRET_KEY` | Spicy Lyrics developer server key for the official lyrics API |

`config.json` contains the Web Player cookie and module settings. Copy the
supplied example on the mirror:

```sh
cp config.example.json config.json
chmod 600 config.json
```

Set `sp_dc` in `config.json` to the cookie value from the Spotify Web Player.
`npm run build` also compiles the bundled Go token refresher, so Go 1.20 or newer
must be installed on the machine performing the build.

Store the current bearer separately in `session.json`:

```sh
cp session.example.json session.json
chmod 600 session.json
```

```json
{
  "SPOTIFY_CLIENT_ID": "CLIENT_ID_PAIRED_WITH_YOUR_REFRESH_TOKEN",
  "SPOTIFY_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN",
  "SPOTIFY_WEB_TOKEN": "OPTIONAL_MANUALLY_UPDATED_WEB_PLAYER_BEARER"
}
```

At start and then at most every 50 minutes, the helper runs `node refresh.js`. That script
runs the compiled Go helper, which reads `sp_dc` from `config.json` and writes the
retrieved bearer to `SPOTIFY_WEB_TOKEN` in `session.json` while preserving its
other values. It also saves `SPOTIFY_WEB_TOKEN_EXPIRES_AT` (Unix milliseconds).
The module loads successful refreshes immediately and checks the file again after
`reloadDelaySeconds`. Renewal is scheduled two minutes before expiry when that is
earlier than the configured interval. Failed refreshes retry after one minute;
anonymous, empty, or expired tokens never overwrite the saved session. A revoked
or expired cookie must be replaced with a fresh `sp_dc` value.
Authentication failures also request early renewal, limited to once per minute.
External changes to `session.json` are picked up on the next playback poll.

When a developer key is configured, lyrics use the official developer API.
The [desktop bridge](spicetify/README.md) and Web Player bearer remain available
for playback or older installations without a developer key. Optional `SPOTIFY_CLIENT_ID` and
`SPOTIFY_REFRESH_TOKEN` credentials renew playback independently; rotated refresh
tokens are saved back to `session.json`. Add `SPOTIFY_CLIENT_SECRET` only when the
issuing flow requires it. With no separate playback credentials, playback also
uses the cookie-derived bearer. `session.json` is ignored by Git.

Run `node refresh.js` to check cookie renewal manually. It reports expiry or an
error without printing the bearer. Token retrieval does not prove Spotify playback
or Spicy Lyrics access: those services can independently reject or rate-limit it.

## Preview and checks

```sh
npm run build
npm run preview
```

Open `http://127.0.0.1:8099`. The preview uses synthetic lyrics and artwork and
needs no account. It uses the same renderer, iframe, and card layouts as the module.
It includes pause, seek, and syllable/line/static/empty states.

```sh
npm test
npm run test:browser
npm run test:setup-browser
```

The browser checks use installed Edge on Windows. Elsewhere install Playwright's
browser with `npx playwright install chromium`. Set `PLAYWRIGHT_BROWSER_PATH` to
use a specific browser executable. Screenshots are written to `artifacts/`.

## How the standalone adaptation works

`upstream/spicy-lyrics` is an unmodified Git clone pinned at the commit recorded in
[`upstream/UPSTREAM.json`](upstream/UPSTREAM.json). The root build:

1. Extracts the original `PageView.ts` page markup, including `NowBar` and
   `LyricsContainer`.
2. Bundles the upstream renderers, animator, virtualizer, scrolling, credits,
   stores, and lyric CSS directly from that source.
3. Replaces five desktop host imports with `standalone/platform.ts`: page mount,
   player clock, compact/PiP flags, and lyrics-container clearing.
4. Applies `standalone/cards.css` to shape the existing page into cards and move
   its existing metadata block above the lyrics in fullscreen.

`standalone/bootstrap.js` supplies the small storage/tooltip interface used by
the renderer. It does not emulate the whole Spicetify application. Each card lives
in an iframe so upstream globals and CSS stay isolated from MagicMirror.
`dist/build-inputs.json` records exactly which upstream files were bundled.

The full upstream source and provider data are retained. Spotify desktop menus,
library actions, PiP, settings pages, local TTML importing, generated romanization,
and animated editorial artwork are not wired into this standalone host. Supplied
transliterations are supported through the original renderer. Clicking lyrics
does not control playback; this module requests only read permission.

The Web API provides polling rather than the desktop player's local clock. The
card interpolates between polls, freezes on pause/outage, and corrects on seeks;
`lyricsOffset` can compensate for device latency. Live timing and lyric availability
still depend on Spotify, the supplied session, and Spicy Lyrics' service.

Licensed under AGPL-3.0; see [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
Upstream: [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics).
