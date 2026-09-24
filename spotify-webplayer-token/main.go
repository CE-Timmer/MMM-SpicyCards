package main

import (
	"flag"
	"fmt"
	"github.com/mirrorfm/spotify-webplayer-token/app"
	"os"
)

func main() {
	configPath := flag.String("config", "config.json", "path to the module config.json")
	sessionPath := flag.String("session", "session.json", "path to the module session.json")
	flag.Parse()

	token, err := app.RefreshSession(*configPath, *sessionPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Spotify Web Player token refreshed; expires at %d\n", token.AccessTokenExpirationTimestampMs)
}
