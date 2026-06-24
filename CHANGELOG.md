# Changelog

All notable changes to Seerr TV are documented here. This project adheres to
[Semantic-ish versioning](https://semver.org/); `VERSION_CODE` increases by at least 1
for every released APK.

## [1.5] — 2026-06-24

First public release.

### Added
- Full **D-pad spatial navigation** with a visible focus highlight — no mouse pointer.
- On-screen keyboard flow for text fields (search, login, server URL).
- Collapsing/auto-hiding sidebar; focused posters **lift**; slim top **loading bar**
  during page renders.
- **Double-press BACK to exit** (with an on-screen hint); render-process crash recovery
  (`onRenderProcessGone` → recreate).
- Trailers open in an external app instead of hijacking the WebView.
- Reliable overlay/menu focus (slideovers, react-select); detail pages land on the
  primary action (Request / Play); row-by-row home sliders.
- First-run server setup that raises the keyboard automatically.

### Security
- WebView remote debugging **gated to debug builds** — never enabled in the release APK.
- `allowBackup=false` — no session-cookie extraction via `adb`/cloud backup.
- **System-CA-only** TLS trust; self-signed servers via a host-scoped trust prompt
  (dropped app-wide user-CA trust).
- Pinned Gradle distribution checksum (supply-chain).
- No analytics or telemetry; stores only the server URL + session locally.
