# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting: go to the
[**Security**](../../security) tab → **Report a vulnerability**. That opens a private
advisory visible only to the maintainers.

Include what you found, how to reproduce it, and the impact. You'll get a response as
soon as reasonably possible.

## Supported versions

Only the latest release receives fixes. Always run the newest APK from the
[Releases](../../releases) page.

## Security model

Seerr TV is a client for a server **you** own. It has no analytics or telemetry and
stores only your server URL and session cookie on the device.

- **WebView remote debugging** is enabled only in debug builds — never in the released APK.
- **`allowBackup=false`** — app data (including the session) can't be extracted via
  `adb backup` or cloud backup.
- **System-CA-only TLS trust.** A self-signed / internal-CA self-hosted server still
  works via a one-time trust prompt **scoped to the exact server host you configured** —
  the app does not trust the device's user CA store app-wide, so a rogue CA can't
  silently MITM third-party origins (Plex sign-in, TMDB, etc.).
- **Cleartext `http` is permitted** for LAN servers reachable only over http (a
  deliberate self-hosting trade-off).
- **No native JavaScript bridge** — page content has no path to Android APIs.
