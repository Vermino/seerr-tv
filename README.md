# Seerr TV

**A TV-remote-friendly Android app for [Jellyseerr](https://github.com/fallenbagel/jellyseerr) / [Seerr](https://github.com/seerr-team/seerr).**

Seerr TV wraps the Jellyseerr / Seerr web interface in a native Android TV / Fire TV
app and adds real **D-pad navigation** — a glowing highlight moves between posters,
buttons and fields, so you can browse and request movies and shows from the couch
with just a remote. No mouse pointer, no phone needed.

On first launch you point it at **your own** Jellyseerr / Seerr server, and it
remembers it.

> [!NOTE]
> This is an **unofficial, community-built client**. It is not affiliated with or
> endorsed by the Jellyseerr or Seerr projects. It is a **client only** — it does not
> run a server. You connect it to a Jellyseerr/Seerr server you already host (the same
> address you'd open in a web browser).

---

## Supported devices

| Device | OS | Supported? |
|---|---|---|
| **ONN Pro 4K (Walmart)** | Google TV / Android TV | ✅ Yes (primary target) |
| **Amazon Fire TV / Firestick** | Fire OS (Android) | ✅ Yes |
| Any Android TV / Google TV box | Android TV | ✅ Yes |
| **Roku** (any model) | Roku OS | ❌ No — Roku cannot run Android APKs |

Minimum **Android 5.0 (API 21)**. The primary target, the ONN Pro 4K, runs Android 11+.

---

## Install

You need to sideload the APK — TV app stores don't carry it.

1. **Get the APK.** Download the latest signed `app-release.apk` from the
   [**Releases**](../../releases) page, or [build it yourself](#building-from-source).

2. **Install it** with either method:

   **Option A — Downloader app (no PC needed):**
   1. On the TV, install **Downloader** (by AFTVnews) from the Play Store / Amazon Appstore.
   2. Host `app-release.apk` somewhere reachable (a local web server, a Google Drive
      direct link, a GitHub release URL, etc.) and open that URL in Downloader.
   3. Downloader downloads it and prompts to install. The first time, it sends you to
      enable **Install unknown apps** for Downloader — turn it on, then install.

   **Option B — adb over the network (from a PC):**
   ```powershell
   # On the TV: Settings > System > About > tap "Build" 7x to unlock Developer
   # options, then enable "USB/Network debugging".
   $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
   & $adb connect <TV_IP>:5555          # accept the prompt on the TV
   & $adb install -r app-release.apk
   ```
   > After sideloading, it's good hygiene to turn **network/USB debugging back off**
   > on the TV. Leaving `adb` open on a shared network is a risk for *any* sideloaded app.

After install, the app appears as **Seerr** with its banner — in the **Apps** row on
Google TV, or under **Your Apps & Channels** on Fire TV.

---

## First run / changing server

On first launch, type your server address (e.g. `http://192.168.1.50:5055` or
`https://seerr.example.com`) and select **Connect**. To switch servers later:
**Hold BACK → Change server**.

Plain `http://` on your home network is fully supported. If your server uses a
self-signed HTTPS certificate, the app asks **once** whether to trust it — and only
for the exact server host you configured (see [Security & privacy](#security--privacy)).

---

## Using it with the remote

It navigates like a proper 10-foot TV app — there is **no mouse pointer**.

| Remote | Action |
|---|---|
| **D-pad arrows** | Move the highlight between posters, buttons and links. Press LEFT past the left edge to open the **sidebar** (lands on Discover); press RIGHT to return to the content. UP from the top row highlights the search box. |
| **Center / OK** | Select the highlighted item — open a title, a sidebar entry, Sign In, etc. |
| **OK on a text box** | Opens the on-screen keyboard to type; **BACK** closes it. |
| **BACK** | From a detail page → previous view; from the main content → opens the sidebar; from the sidebar → press BACK again to exit. |
| **Hold BACK**, or **MENU** | Options (Reload, Home, Change server, Help, Exit). |
| **Search / mic button** | Jumps to the search box and raises the keyboard. |

The **sidebar auto-hides** while you browse content (full-width) and slides in when
you go left. Focused posters lift slightly, and a slim top loading bar shows while a
page is rendering. A short help card appears on first launch. The focus engine is
injected (`app/src/main/assets/spatnav.js`) because the Jellyseerr web UI has no
built-in remote support of its own.

---

## Security & privacy

Seerr TV is a thin client for a server **you** own. It has no analytics, no telemetry,
and phones home to nothing — the only things it stores on the device are the server
URL you type and the session cookie from signing in to your server.

It is deliberately tuned for self-hosting, while staying hardened for a sideloaded app:

- **Cleartext `http` is allowed** so LAN servers reachable only over http work.
- **Trust is limited to the system CA store.** A self-signed or internal-CA server is
  still reachable, but it falls through to a one-time TLS-trust prompt that is **scoped
  to the exact server host you configured** — never to any other origin the page
  references. (The app does *not* trust the device's user-installed CA store app-wide,
  so a rogue CA can't silently intercept Plex sign-in, TMDB, etc.)
- **No app data backup.** `allowBackup` is off, so your session can't be pulled off the
  device via `adb backup` or cloud backup.
- **WebView remote debugging ships disabled.** It is enabled only in debug builds, never
  in the released APK.
- **No native JavaScript bridge.** The page has no path to Android APIs.

---

## Building from source

**Prerequisites:**
- **JDK 17** (`JAVA_HOME` pointing at it)
- **Android SDK** with platform 34 + build-tools 34 (put `sdk.dir=...` in `local.properties`,
  or set `ANDROID_HOME`)

**Build:**
```bat
build.bat            REM signed release APK (debug-signed if you have no keystore)
build.bat debug      REM debug APK
```
or directly:
```bat
gradlew.bat assembleRelease
```

The APK lands in:
```
app/build/outputs/apk/release/app-release.apk     <- share/sideload this one
app/build/outputs/apk/debug/app-debug.apk         <- debug build (DevTools enabled)
```

> Cloning without a signing keystore is fine: the release build automatically falls
> back to **debug signing** so it still builds. A debug-signed APK is for testing only —
> don't distribute it.

### Releasing an update

Bump the version in **`version.properties`** before every APK you distribute:
```
VERSION_NAME=1.6
VERSION_CODE=7      # MUST increase by at least 1, or Android refuses to update
```
The release build is signed with a keystore configured in `keystore.properties`
(pointing at e.g. `keystore/seerr-release.jks`). **Keep that keystore safe and private** —
updates must be signed with the *same* key to install over a previous version. The
keystore and its password file are git-ignored and are **never** committed.

---

## Known limitations

- **Roku is not supported** (it's not Android; an APK can't run on it).
- **Avatar image upload** from the TV isn't supported — use Jellyseerr's Gravatar or
  avatar-URL option instead.
- Very old Fire TV Sticks (Fire OS 5) ship an outdated Android System WebView that may
  not render the modern Jellyseerr UI — update Android System WebView or use a newer
  device. The ONN Pro and current Fire TV devices are fine.
- The app forces the **desktop layout** (wide) so the 10-foot screen isn't a narrow
  phone column. To change it, see `DESKTOP_CSS_WIDTH` in `WebActivity.java`.

---

## License

[MIT](./LICENSE). Seerr TV is an independent client; Jellyseerr and Seerr are the work
of their respective teams and are not affiliated with this project.
