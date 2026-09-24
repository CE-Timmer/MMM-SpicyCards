package app

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const UserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
const SecretsURL = "https://raw.githubusercontent.com/xyloflake/spot-secrets-go/main/secrets/secretDict.json"

type Token struct {
	ClientID                         string `json:"clientId"`
	AccessToken                      string `json:"accessToken"`
	AccessTokenExpirationTimestampMs int64  `json:"accessTokenExpirationTimestampMs"`
	IsAnonymous                      bool   `json:"isAnonymous"`
}

type configFile struct {
	SpDC string `json:"sp_dc"`
	Spdc string `json:"spdc"`
}

// RefreshSession reads the Spotify sp_dc cookie from configPath, retrieves a
// fresh Web Player token, and stores it in sessionPath. Existing session values
// are preserved.
func RefreshSession(configPath, sessionPath string) (*Token, error) {
	configBytes, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("could not read config %q: %w", configPath, err)
	}

	var config configFile
	if err := json.Unmarshal(configBytes, &config); err != nil {
		return nil, fmt.Errorf("could not parse config %q: %w", configPath, err)
	}
	spDC := strings.TrimSpace(config.SpDC)
	if spDC == "" {
		spDC = strings.TrimSpace(config.Spdc)
	}
	if spDC == "" {
		return nil, fmt.Errorf("config %q does not contain a non-empty sp_dc", configPath)
	}

	token, err := GetAccessToken(spDC)
	if err != nil {
		return nil, err
	}
	if token == nil || strings.TrimSpace(token.AccessToken) == "" || token.IsAnonymous || token.AccessTokenExpirationTimestampMs <= time.Now().UnixMilli() {
		return nil, fmt.Errorf("Spotify did not return a valid authenticated token; replace the sp_dc cookie")
	}

	session := make(map[string]any)
	if sessionBytes, readErr := os.ReadFile(sessionPath); readErr == nil {
		if len(strings.TrimSpace(string(sessionBytes))) > 0 {
			if err := json.Unmarshal(sessionBytes, &session); err != nil {
				return nil, fmt.Errorf("could not parse session %q: %w", sessionPath, err)
			}
		}
	} else if !os.IsNotExist(readErr) {
		return nil, fmt.Errorf("could not read session %q: %w", sessionPath, readErr)
	}

	if session == nil {
		return nil, fmt.Errorf("session must be a JSON object")
	}
	session["SPOTIFY_WEB_TOKEN"] = token.AccessToken
	session["SPOTIFY_WEB_TOKEN_EXPIRES_AT"] = token.AccessTokenExpirationTimestampMs
	encoded, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("could not encode session: %w", err)
	}
	encoded = append(encoded, '\n')
	// Replace atomically so readers never see a truncated JSON document.
	temporary, err := os.CreateTemp(filepath.Dir(sessionPath), ".spotify-session-*")
	if err != nil {
		return nil, fmt.Errorf("could not create temporary session: %w", err)
	}
	defer os.Remove(temporary.Name())
	if _, err = temporary.Write(encoded); err == nil {
		err = temporary.Sync()
	}
	closeErr := temporary.Close()
	if err != nil {
		return nil, fmt.Errorf("could not write session: %w", err)
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err := os.Rename(temporary.Name(), sessionPath); err != nil {
		return nil, fmt.Errorf("could not write session %q: %w", sessionPath, err)
	}

	return token, nil
}

// GetAccessTokenFromEnv reads SPOTIFY_DC from the environment.
// SPOTIFY_KEY is no longer required by Spotify.
func GetAccessTokenFromEnv() (*Token, error) {
	spDc, exists := os.LookupEnv("SPOTIFY_DC")
	if !exists {
		fmt.Println("missing SPOTIFY_DC")
		return nil, nil
	}

	return GetAccessToken(spDc)
}

// GetAccessToken fetches a web player access token using the sp_dc cookie.
func GetAccessToken(spDc string) (*Token, error) {
	// Fetch TOTP cipher secrets
	secretDict, err := fetchSecrets()
	if err != nil {
		return nil, fmt.Errorf("failed to fetch TOTP secrets: %w", err)
	}

	// Use the latest version
	var ver string
	var cipher []int
	maxVer := 0
	for k := range secretDict {
		v, _ := strconv.Atoi(k)
		if v > maxVer {
			maxVer = v
			ver = k
		}
	}
	cipher = secretDict[ver]
	if len(cipher) == 0 {
		return nil, fmt.Errorf("no valid TOTP secret version available")
	}

	// Generate TOTP
	code, err := generateTOTP(cipher)
	if err != nil {
		return nil, fmt.Errorf("failed to generate TOTP: %w", err)
	}

	// Build request
	url := fmt.Sprintf(
		"https://open.spotify.com/api/token?reason=transport&productType=web-player&totp=%s&totpServer=%s&totpVer=%s",
		code, code, ver,
	)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://open.spotify.com/")
	req.Header.Set("App-Platform", "WebPlayer")
	req.Header.Set("Cookie", fmt.Sprintf("sp_dc=%s", spDc))

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("could not read response body: %w", err)
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("token request returned HTTP %d", resp.StatusCode)
	}

	token := Token{}
	if err := json.Unmarshal(body, &token); err != nil {
		return nil, fmt.Errorf("could not unmarshal token JSON: %w", err)
	}

	return &token, nil
}

func fetchSecrets() (map[string][]int, error) {
	req, _ := http.NewRequest("GET", SecretsURL, nil)
	req.Header.Set("User-Agent", UserAgent)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("secret request returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result map[string][]int
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func generateTOTP(cipher []int) (string, error) {
	// XOR transform
	transformed := make([]int, len(cipher))
	for t, e := range cipher {
		transformed[t] = e ^ ((t % 33) + 9)
	}

	// Join as string, then hex encode
	var sb strings.Builder
	for _, num := range transformed {
		sb.WriteString(strconv.Itoa(num))
	}
	hexStr := hex.EncodeToString([]byte(sb.String()))

	// Base32 encode
	hexBytes, err := hex.DecodeString(hexStr)
	if err != nil {
		return "", err
	}
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(hexBytes)

	// Generate 6-digit TOTP (30s interval, SHA1)
	now := time.Now().Unix()
	counter := uint64(math.Floor(float64(now) / 30))

	secretBytes, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return "", err
	}

	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)

	mac := hmac.New(sha1.New, secretBytes)
	mac.Write(buf)
	hash := mac.Sum(nil)

	offset := hash[len(hash)-1] & 0x0f
	truncated := binary.BigEndian.Uint32(hash[offset:offset+4]) & 0x7fffffff
	code := truncated % 1000000

	return fmt.Sprintf("%06d", code), nil
}
