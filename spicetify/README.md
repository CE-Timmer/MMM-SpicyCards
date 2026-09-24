# SpotifyCards desktop token bridge

Runs on the computer with **Spotify Desktop + Spicetify** and sends its session
token to MMM-SpotifyCards on the same computer or a different MagicMirror server.
Spicy Lyrics does not need to be installed on the transmitting computer.

## 1. Enable the receiver on the MagicMirror device

In the MMM-SpotifyCards directory, under the same OS account that runs MagicMirror:

```sh
npm run bridge -- --host 0.0.0.0 --port 8890
```

Keep the printed **pairing key**, then restart MagicMirror. The helper starts its
own receiver on port **8890**, including when MagicMirror runs in server mode.
This is separate from the usual MagicMirror page port, 8080. Allow incoming TCP
8890 from your Spotify computer in the mirror device's firewall.

The address you enter in the extension is the **MagicMirror server's** IP,
not the display/browser device's IP. For example: `http://192.168.1.50:8890`.
`0.0.0.0` is a listening address; never enter it as the destination.

The command saves `desktop-bridge.json` beside your private `credentials.json`
(normally `~/.config/MMM-SpotifyCards/`). No pairing key belongs in MagicMirror's
browser-visible module config. `SPOTIFYCARDS_CREDENTIAL_FILE` also determines this
directory, so use the same override for setup and MagicMirror if applicable.

## 2. Install the extension on the Spotify computer

From a copy of this repository on that computer:

```sh
npm run bridge:install
spicetify apply
```

The installer copies `spotifycards-bridge.js` into Spicetify's Extensions directory
and adds it to the existing extensions list. Applying may restart Spotify.
Alternatively, copy the JS file into that directory manually and run:

```sh
spicetify config extensions spotifycards-bridge.js
spicetify apply
```

In Spotify's **profile menu → SpotifyCards Bridge**, enter:

- **Mirror address:** `http://192.168.1.50:8890` (replace the example IP).
- **Pairing key:** the key printed on the mirror.
- Enable forwarding and click **Save and send now**.

The status reports delivery or a connection/pairing error. You can change the IP,
port, key, or disable forwarding from this menu at any time. No source edits needed.
Address and pairing key are stored in Spicetify's local settings; the Spotify token
is not. Keep Spotify running and signed in to transmit renewed tokens.

## Renewal and token selection

The extension follows the same token sources as the pinned Spicy Lyrics code:
`Platform.AuthorizationAPI.getState()`, then `CosmosAsync.get("sp://oauth/v2/token")`,
then `Platform.Session`. It rejects anonymous and nearly expired sessions.
Spotify itself renews the desktop session; this extension forwards that renewal.

It checks every 30 seconds, sends a changed token immediately on the next check,
and resends an unchanged valid token every five minutes. Failed deliveries retry
with a 30-second to five-minute backoff. **Save and send now** forces a retry.

The receiver saves the bearer and expiry atomically to private
`desktop-session.json`. With a Spicy Lyrics developer key configured, lyrics use
the official developer API. Desktop tokens remain available for playback and for
legacy lyrics requests without that key. Existing OAuth/access-token playback configuration
remains preferred for playback; without it, the desktop token can also supply
playback access. Expired desktop tokens fall back to the configured cookie token.
Fresh tokens are read on the next poll without restarting MagicMirror.

## Connections and troubleshooting

HTTP is intended for a trusted LAN: the pairing key authenticates the sender but
does not encrypt the connection. For other networks, use HTTPS through your
reverse proxy or a private tunnel. An HTTPS proxy should forward
`/spotifycards/token` to the receiver and preserve the `X-SpotifyCards-Key` header.
The extension accepts an HTTPS base URL and optional proxy path prefix.

If Spotify's embedded browser blocks HTTP access to a LAN IP, use an HTTPS endpoint
with a certificate that the Spotify computer trusts. The receiver supports Spotify
desktop's origin, CORS preflight, and private-network preflight requests.
Current Chromium versions can also ask permission for Spotify to access the local
network; allow that prompt on the transmitting computer for LAN delivery.

- **Cannot reach mirror:** check the server IP, port 8890, firewall, and whether the
  helper logs `Desktop bridge listening` after restarting MagicMirror.
- **Pairing key rejected:** copy the same key into the extension. Run `npm run bridge`
  again to show the existing key, or `npm run bridge -- --rotate` to generate a new
  one; restart MagicMirror after changing its configuration.
- **Waiting for a fresh session:** sign in to Spotify Desktop and allow its token
  to renew. Keep both computers' clocks correct.
- **Delivered but no lyrics:** delivery confirms receipt, not provider acceptance.
  Spotify/Spicy Lyrics may still reject a token, rate-limit requests, or have no
  lyrics for the track. This bridge does not bypass those responses.

To disable the receiver: `npm run bridge -- --disable`, then restart MagicMirror.
An already received token stays usable until expiry; remove `desktop-session.json`
from the private configuration directory to stop using it immediately.

References: [Spicetify Platform API](https://spicetify.app/docs/development/api-wrapper/methods/platform)
and the repository's pinned `upstream/spicy-lyrics/src/components/Global/Platform.ts`.
