# spotify-webplayer-token

Helper to retrieve a Spotify web player access token using the `sp_dc` cookie.

Uses TOTP authentication with cipher secrets from [spot-secrets-go](https://github.com/xyloflake/spot-secrets-go).

## To obtain the `sp_dc` cookie (valid for ~1 year):

 - Open a new Incognito window in Chrome at https://accounts.spotify.com/en/login?continue=https:%2F%2Fopen.spotify.com%2F
 - Open Developer Tools
 - Login to Spotify
 - Go to **Application tab → Cookies → `https://open.spotify.com`**
 - Copy the value of `sp_dc`
 - Close the window **without logging out** (logging out invalidates the cookie)

## To obtain a Spotify token:

### Programmatically

1. Set the `SPOTIFY_DC` environment variable
2. Do:

    ```golang
    import (
        "github.com/mirrorfm/spotify-webplayer-token/app"
    )

    func main() {
        token, err := app.GetAccessTokenFromEnv()
        // use token.AccessToken
    }
    ```

### From MMM-SpotifyCards

From the module root, build both the browser bundle and this helper:

```sh
npm run build
```

The module's `refresh.js` launches the resulting native executable. It reads
`sp_dc` from the module's `config.json`, retrieves a new bearer, and updates
`SPOTIFY_WEB_TOKEN` in the module's `session.json` without removing the other
session values.

The executable can also be called directly:

```sh
./spotify-webplayer-token/bin/spotify-webplayer-token \
  -config ./config.json -session ./session.json
```
