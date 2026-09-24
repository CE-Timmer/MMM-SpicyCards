package app

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRefreshSession(t *testing.T) {
	for _, scenario := range []string{"success", "anonymous", "expired", "empty", "secrets-unavailable", "token-rejected", "null-session"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			config, session := filepath.Join(dir, "config.json"), filepath.Join(dir, "session.json")
			os.WriteFile(config, []byte(`{"sp_dc":"test-cookie"}`), 0600)
			original := `{"other":"preserved","SPOTIFY_WEB_TOKEN":"old"}`
			if scenario == "null-session" {
				original = "null"
			}
			os.WriteFile(session, []byte(original), 0600)
			previous := http.DefaultTransport
			defer func() { http.DefaultTransport = previous }()
			http.DefaultTransport = transportFunc(func(r *http.Request) (*http.Response, error) {
				status, body := 200, `{"61":[44,55,47,42]}`
				if r.URL.Host == "open.spotify.com" {
					if r.Header.Get("Cookie") != "sp_dc=test-cookie" {
						t.Fatal("missing cookie")
					}
					if r.URL.Query().Get("totpVer") != "61" || len(r.URL.Query().Get("totp")) != 6 {
						t.Fatal("invalid TOTP query")
					}
					token := Token{AccessToken: "new", AccessTokenExpirationTimestampMs: time.Now().Add(time.Hour).UnixMilli()}
					if scenario == "anonymous" {
						token.IsAnonymous = true
					}
					if scenario == "expired" {
						token.AccessTokenExpirationTimestampMs = 1
					}
					if scenario == "empty" {
						token.AccessToken = ""
					}
					data, _ := json.Marshal(token)
					body = string(data)
					if scenario == "token-rejected" {
						status = 401
						body = "sensitive-response"
					}
				} else if scenario == "secrets-unavailable" {
					status = 503
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})
			_, err := RefreshSession(config, session)
			saved, _ := os.ReadFile(session)
			if scenario != "success" {
				if err == nil {
					t.Fatal("expected rejection")
				}
				if strings.Contains(err.Error(), "sensitive-response") {
					t.Fatal("response leaked")
				}
				if string(saved) != original {
					t.Fatal("failed refresh changed session")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var result map[string]any
			json.Unmarshal(saved, &result)
			if result["other"] != "preserved" || result["SPOTIFY_WEB_TOKEN"] != "new" || result["SPOTIFY_WEB_TOKEN_EXPIRES_AT"] == nil {
				t.Fatal("session not preserved or token not updated")
			}
		})
	}
}
