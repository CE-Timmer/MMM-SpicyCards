# Third-party software

The Spicy Lyrics packed-response codec in `vendor/objpack.ts` is from
[Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics), commit
`d804ca34c39e255495ddeaee61dc1a9eb6f81197`, under AGPL-3.0.
`vendor/objpack.js` is its TypeScript-to-CommonJS compilation (ES2020).
Copyright remains with its original authors. The license is included in `LICENSE`.

The full source clone is included in `upstream/spicy-lyrics` at that commit.
The standalone build bundles its original lyric renderers, animator, scrolling,
virtualizer, credits, stores, and lyric CSS. It extracts the original PageView
markup and supplies a separate host boundary and card layout stylesheet.
Spicetify's desktop integration and settings pages are not launched.
The MagicMirror connection and standalone adapters are new code under AGPL-3.0.
This project is not affiliated with Spotify or Spicy Lyrics.
