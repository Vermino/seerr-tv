# Contributing to Seerr TV

Thanks for your interest! Seerr TV is a small, focused project, so this guide is short.

## What Seerr TV is

A thin **Android TV / Fire TV WebView wrapper** around the Jellyseerr / Seerr web UI.
It does **not** reimplement the server's features — it renders the existing web app and
adds a TV-remote experience on top. The interesting code is:

- `app/src/main/java/com/seerr/tv/WebActivity.java` — hosts the WebView, the native
  host (options menu, error recovery, double-press-BACK exit), key handling, the
  on-screen keyboard flow, and the host-scoped TLS prompt.
- `app/src/main/assets/spatnav.js` — the injected **spatial-navigation engine** that
  moves a visible focus highlight between real page elements (no mouse pointer).
- `app/src/main/java/com/seerr/tv/SetupActivity.java` — the first-run server-URL screen.

Because the app wraps the web UI, **most "feature" requests belong upstream** in
[Jellyseerr](https://github.com/fallenbagel/jellyseerr). Good contributions here are
about the **TV/remote experience**: focus navigation, the native host, setup, and build.

## Building

Prerequisites:
- **JDK 17** (`JAVA_HOME` set)
- **Android SDK** with platform 34 + build-tools 34 (`local.properties` with `sdk.dir=…`,
  or `ANDROID_HOME`)

```bat
build.bat            REM signed release APK (debug-signed if you have no keystore)
build.bat debug      REM debug APK
```
or `gradlew.bat assembleRelease`. Cloning without the signing keystore is fine — the
release build falls back to debug signing so it still builds.

## Pull requests

- Keep changes focused; match the surrounding code style (plain Java, no extra deps).
- Test on a **real** Android TV / Fire TV device when you touch navigation or the host —
  D-pad behavior is hard to validate in an emulator.
- CI builds a debug APK on every PR (`.github/workflows/ci.yml`); keep it green.

## Releasing (maintainers)

1. Bump `version.properties` (`VERSION_CODE` **must** increase by ≥1).
2. Commit, then tag and push:
   ```bash
   git tag v1.6 && git push origin v1.6
   ```
3. `.github/workflows/release.yml` builds the signed APK and attaches it to the Release.

The release workflow signs using repository **Actions secrets** (never committed):
`KEYSTORE_BASE64`, `KEYSTORE_STORE_PASSWORD`, `KEYSTORE_KEY_PASSWORD`, `KEYSTORE_KEY_ALIAS`.
The signing keystore must stay private — updates must be signed with the same key.
