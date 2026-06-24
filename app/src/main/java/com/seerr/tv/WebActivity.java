package com.seerr.tv;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Hosts the Jellyseerr / Seerr web UI in a WebView and makes it fully usable with
 * a TV remote using D-pad focus navigation (no mouse pointer): an injected spatial
 * navigation engine moves a visible highlight between real elements (login fields,
 * sign-in, sidebar items, poster art), OK activates the highlighted element, and
 * text fields raise the on-screen keyboard. Long-press BACK or MENU opens options.
 *
 * Security trade-off (intentional, for self-hosted LAN servers): cleartext http is
 * permitted app-wide (network_security_config.xml) so a server reachable only over http
 * on the LAN works, but the only origin allowed to bypass a TLS/certificate error (e.g. a
 * self-signed cert) is the user's configured server host -- never any third-party origin.
 */
public class WebActivity extends AppCompatActivity {

    /** CSS layout width forced on the page so Jellyseerr renders its desktop layout
     *  (with the sidebar + multi-column poster grid) on a 10-foot screen. */
    private static final int DESKTOP_CSS_WIDTH = 1280;

    private FrameLayout root;
    private WebView webView;
    private ProgressBar progress;
    private View errorOverlay;

    private String serverUrl;
    private String spatNavJs;
    private boolean started;
    private long backDownTime;
    private boolean backConsumedByLongPress;
    private boolean exitArmed; // require a 2nd BACK at an exit boundary so a stray press can't kill the app

    private InputMethodManager imm;

    private AlertDialog optionsDialog, sslDialog, helpDialog, coachDialog;
    private final Set<String> approvedSslHosts = new HashSet<>();

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable allowSleep = new Runnable() {
        @Override public void run() {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    };
    private final Runnable backLongPress = new Runnable() {
        @Override public void run() {
            backConsumedByLongPress = true;
            showOptions();
        }
    };
    private final Runnable disarmExit = () -> exitArmed = false;

    /** Double-press-to-exit: first BACK at an exit boundary shows a hint and arms a 2s
     *  window; only a second BACK within it actually closes the app. */
    private void confirmExit() {
        if (exitArmed) { ui.removeCallbacks(disarmExit); finishAffinity(); return; }
        exitArmed = true;
        Toast.makeText(this, R.string.exit_hint, Toast.LENGTH_SHORT).show();
        ui.removeCallbacks(disarmExit);
        ui.postDelayed(disarmExit, 2000);
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences(SetupActivity.PREFS, MODE_PRIVATE);
        serverUrl = prefs.getString(SetupActivity.KEY_URL, null);
        if (TextUtils.isEmpty(serverUrl)) {
            openSetup();
            return;
        }

        setContentView(R.layout.activity_web);
        imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        spatNavJs = loadAsset("spatnav.js");

        root = findViewById(R.id.web_root);
        webView = findViewById(R.id.webview);
        progress = findViewById(R.id.progress);
        errorOverlay = findViewById(R.id.error_overlay);

        configureWebView();

        Button retry = findViewById(R.id.error_retry);
        Button change = findViewById(R.id.error_change);
        retry.setOnClickListener(v -> { hideError(); webView.loadUrl(serverUrl); });
        change.setOnClickListener(v -> openSetup());

        webView.loadUrl(serverUrl);
        keepAwake();

        root.post(this::maybeShowCoach);
        started = true;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        // Remote WebView inspection (chrome://inspect) in debuggable builds only. It is
        // never enabled in the released APK, so a local process or an adb session on the
        // LAN cannot attach to the live, authenticated session.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(Color.parseColor("#111827"));
        webView.setWebViewClient(new SeerrWebViewClient());
        webView.setWebChromeClient(new SeerrWebChromeClient());
    }

    private class SeerrWebChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (newProgress >= 100) {
                progress.setVisibility(View.GONE);
            } else {
                progress.setVisibility(View.VISIBLE);
                progress.setProgress(newProgress);
            }
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // Jellyseerr opens trailers / Plex sign-in via target=_blank / window.open.
            final WebView temp = new WebView(WebActivity.this);
            temp.getSettings().setJavaScriptEnabled(true);
            temp.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) { return route(v, req.getUrl()); }
                @SuppressWarnings("deprecation")
                @Override public boolean shouldOverrideUrlLoading(WebView v, String url) { return route(v, Uri.parse(url)); }
                private boolean route(WebView v, Uri uri) {
                    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
                    if (scheme.equals("http") || scheme.equals("https")) {
                        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
                        // Trailers should play in the system video/YouTube app and BACK should
                        // return cleanly to Seerr — not hijack the main WebView. Other popups
                        // (e.g. Plex sign-in, which must return to the page) keep loading inline.
                        if (host.contains("youtube.com") || host.contains("youtu.be") || host.contains("vimeo.com")) {
                            try {
                                Intent it = new Intent(Intent.ACTION_VIEW, uri);
                                it.addCategory(Intent.CATEGORY_BROWSABLE);
                                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(it);
                            } catch (Exception e) { webView.loadUrl(uri.toString()); }
                        } else {
                            webView.loadUrl(uri.toString());
                        }
                    } else { handleUrl(uri); }
                    v.destroy();
                    return true;
                }
            });
            ((WebView.WebViewTransport) resultMsg.obj).setWebView(temp);
            resultMsg.sendToTarget();
            return true;
        }
    }

    private class SeerrWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
            forceDesktopWidth();
            injectNav();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showError();
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            showError(); // API < 23 only
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The WebView renderer was killed (typically OOM on a 1GB box). If we do nothing
            // the framework tears the whole app down; instead recover by recreating cleanly.
            if (view == webView) {
                try {
                    ViewParent p = webView.getParent();
                    if (p instanceof ViewGroup) ((ViewGroup) p).removeView(webView);
                    webView.destroy();
                } catch (Exception ignored) { }
                webView = null;
                ui.post(WebActivity.this::recreate);
            }
            return true; // handled — don't crash
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            String serverHost = Uri.parse(serverUrl).getHost();
            String failingUrl = error.getUrl();
            String failingHost = (failingUrl != null) ? Uri.parse(failingUrl).getHost() : null;
            boolean mainFrame = (failingUrl == null) || failingUrl.equals(view.getUrl());

            if (serverHost == null || failingHost == null || !serverHost.equalsIgnoreCase(failingHost)) {
                handler.cancel();
                if (mainFrame) showError();
                return;
            }
            final String hostKey = failingHost.toLowerCase(Locale.ROOT);
            if (approvedSslHosts.contains(hostKey)) { handler.proceed(); return; }
            if (sslDialog != null && sslDialog.isShowing()) { handler.cancel(); return; }

            sslDialog = new AlertDialog.Builder(WebActivity.this)
                    .setTitle("Certificate warning")
                    .setMessage("The certificate for " + failingHost + " is not trusted (code "
                            + error.getPrimaryError() + "). Only continue if this is a server you own.")
                    .setPositiveButton("Continue", (d, w) -> { approvedSslHosts.add(hostKey); handler.proceed(); })
                    .setNegativeButton("Cancel", (d, w) -> { handler.cancel(); showError(); })
                    .setOnCancelListener(d -> { handler.cancel(); showError(); })
                    .setOnDismissListener(d -> sslDialog = null)
                    .create();
            sslDialog.show();
        }
    }

    /** Force desktop layout width so the sidebar + multi-column grid render. */
    private void forceDesktopWidth() {
        String js = "(function(){function v(){var m=document.querySelector('meta[name=viewport]');"
                + "if(!m){m=document.createElement('meta');m.setAttribute('name','viewport');"
                + "(document.head||document.documentElement).appendChild(m);}"
                + "var w='width=" + DESKTOP_CSS_WIDTH + ", user-scalable=no';"
                + "if(m.getAttribute('content')!==w)m.setAttribute('content',w);}v();"
                + "try{new MutationObserver(v).observe(document.head||document.documentElement,"
                + "{childList:true,subtree:true,attributes:true});}catch(e){}})();";
        webView.evaluateJavascript(js, null);
    }

    private void injectNav() {
        if (spatNavJs != null) webView.evaluateJavascript(spatNavJs, null);
    }

    /** Raise the on-screen keyboard for the focused web text field. We (re)create the
     *  WebView's input connection first so the IME attaches to the focused editable and
     *  actually accepts text (otherwise it shows but the remote can't drive it), and we
     *  show it without SHOW_IMPLICIT, which TV launchers tend to auto-dismiss. */
    private void showKeyboard() {
        webView.requestFocus();
        if (imm == null) return;
        // Focus the DOM field only AFTER the WebView holds view-focus: a JS focus() issued
        // before that is silently dropped (activeElement falls back to <body>), so the IME
        // would open with no target and typed characters would go nowhere. Then raise it.
        webView.evaluateJavascript("window.__seerrFocusInput&&window.__seerrFocusInput()", value -> {
            imm.restartInput(webView);
            imm.showSoftInput(webView, 0);
        });
        // One delayed retry: the input connection can land a beat after focus.
        ui.postDelayed(() -> {
            if (imm != null && !(imm.isActive(webView) && imm.isAcceptingText())) imm.showSoftInput(webView, 0);
        }, 150);
    }

    /** Hide the keyboard and hand control back to spatial navigation. Blurring the web
     *  field tears down the input connection so the keyboard-up probe (isAcceptingText)
     *  flips false and D-pad navigation resumes. */
    private void dismissKeyboard() {
        if (imm != null) imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
        webView.requestFocus();
        webView.evaluateJavascript(
            "(function(){try{if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();}"
            + "catch(e){}window.__seerrNav&&window.__seerrNav('pick');})()", null);
    }

    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (scheme.equals("http") || scheme.equals("https")) return false;
        if (scheme.equals("mailto") || scheme.equals("tel")) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, uri);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                startActivity(i);
            } catch (Exception ignored) { }
        }
        return true;
    }

    // ---- Remote handling -----------------------------------------------------------

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int kc = event.getKeyCode();
        int action = event.getAction();

        if (!started) return super.dispatchKeyEvent(event);

        // On the connection-error screen: let the D-pad navigate Retry/Change, but keep MENU
        // (options) reachable and guard BACK so a single press can't drop to the launcher.
        if (errorOverlay.getVisibility() == View.VISIBLE) {
            if (kc == KeyEvent.KEYCODE_MENU) { if (action == KeyEvent.ACTION_DOWN) showOptions(); return true; }
            if (kc == KeyEvent.KEYCODE_BACK) { if (action == KeyEvent.ACTION_UP) confirmExit(); return true; }
            return super.dispatchKeyEvent(event);
        }

        if (action == KeyEvent.ACTION_DOWN) keepAwake();

        // When the on-screen keyboard is up, let it own the keys so the remote can drive
        // it. BACK dismisses the keyboard (and must not exit the app); everything else
        // goes to the IME. The probe is true while a web text field is the active served
        // editable — which, in D-pad use, only happens when we raised the keyboard
        // (setFocus never .focus()es a text field; only OK/SEARCH does, alongside the IME).
        // dismissKeyboard() blurs the field so the probe flips false and nav resumes.
        boolean imeUp = imm != null && imm.isActive(webView) && imm.isAcceptingText();
        if (imeUp) {
            switch (kc) {
                case KeyEvent.KEYCODE_BACK:
                    if (action == KeyEvent.ACTION_UP) dismissKeyboard();
                    return true;
                case KeyEvent.KEYCODE_DPAD_UP:
                case KeyEvent.KEYCODE_DPAD_DOWN:
                case KeyEvent.KEYCODE_DPAD_LEFT:
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                case KeyEvent.KEYCODE_NUMPAD_ENTER:
                case KeyEvent.KEYCODE_BUTTON_A:
                    return super.dispatchKeyEvent(event);
            }
        }

        switch (kc) {
            case KeyEvent.KEYCODE_DPAD_LEFT:  if (action == KeyEvent.ACTION_DOWN) nav("left");  return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT: if (action == KeyEvent.ACTION_DOWN) nav("right"); return true;
            case KeyEvent.KEYCODE_DPAD_UP:    if (action == KeyEvent.ACTION_DOWN) nav("up");    return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:  if (action == KeyEvent.ACTION_DOWN) nav("down");  return true;

            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) navEnter();
                return true;

            case KeyEvent.KEYCODE_BACK:
                if (action == KeyEvent.ACTION_DOWN) {
                    if (event.getRepeatCount() == 0) {
                        backDownTime = SystemClock.uptimeMillis();
                        backConsumedByLongPress = false;
                        ui.removeCallbacks(backLongPress);
                        ui.postDelayed(backLongPress, ViewConfiguration.getLongPressTimeout());
                    }
                } else if (action == KeyEvent.ACTION_UP) {
                    ui.removeCallbacks(backLongPress);
                    if (!backConsumedByLongPress) handleBack();
                }
                return true;

            case KeyEvent.KEYCODE_MENU:
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) showOptions();
                return true;

            case KeyEvent.KEYCODE_SEARCH:
            case KeyEvent.KEYCODE_VOICE_ASSIST:
            case KeyEvent.KEYCODE_ASSIST:
                // Mic / search button -> focus the search box and raise the keyboard
                // (the leanback keyboard provides voice input when available).
                if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) openSearch();
                return true;

            default:
                return super.dispatchKeyEvent(event);
        }
    }

    private void nav(String dir) {
        webView.evaluateJavascript("window.__seerrNav&&window.__seerrNav('" + dir + "')", null);
    }

    private void navEnter() {
        webView.evaluateJavascript("window.__seerrNav&&window.__seerrNav('enter')", value -> {
            // A text field was focused -> raise the on-screen keyboard. ('select' opens
            // an in-page option overlay and needs no keyboard.)
            if (value != null && value.contains("input")) showKeyboard();
        });
    }

    private void openSearch() {
        webView.evaluateJavascript("(window.__seerrNav&&window.__seerrNav('search'))||''", value -> {
            if (value != null && value.contains("input")) showKeyboard();
        });
    }

    private void handleBack() {
        // The page decides: detail/sub page -> go back; home content -> open the
        // sidebar; sidebar -> 'exit'. JS drives history.back() itself because the
        // native back-list can desync from the page's history after a hard nav.
        webView.evaluateJavascript("(window.__seerrNav&&window.__seerrNav('back'))||''", value -> {
            String v = value == null ? "" : value;
            if (v.contains("exit")) { confirmExit(); return; }
            if (v.contains("goback") || v.contains("sidebar")) { exitArmed = false; return; } // handled in the page
            if (webView.canGoBack()) { exitArmed = false; webView.goBack(); } else confirmExit(); // engine not ready
        });
    }

    private void keepAwake() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        ui.removeCallbacks(allowSleep);
        ui.postDelayed(allowSleep, 5 * 60 * 1000L);
    }

    // ---- Menus / navigation --------------------------------------------------------

    private void maybeShowCoach() {
        SharedPreferences prefs = getSharedPreferences(SetupActivity.PREFS, MODE_PRIVATE);
        if (prefs.getBoolean("seen_hint", false)) return;
        prefs.edit().putBoolean("seen_hint", true).apply();
        coachDialog = new AlertDialog.Builder(this)
                .setTitle(R.string.menu_help)
                .setMessage(R.string.help_text)
                .setPositiveButton(R.string.ok, null)
                .create();
        coachDialog.show();
    }

    private void showOptions() {
        if (optionsDialog != null && optionsDialog.isShowing()) return;
        String[] items = {
                getString(R.string.menu_reload),
                getString(R.string.menu_home),
                getString(R.string.menu_change_server),
                getString(R.string.menu_help),
                getString(R.string.menu_exit),
        };
        optionsDialog = new AlertDialog.Builder(this)
                .setTitle(R.string.menu_title)
                .setItems(items, (d, which) -> {
                    switch (which) {
                        case 0: webView.reload(); break;
                        case 1: webView.loadUrl(serverUrl); break;
                        case 2: dismissDialog(optionsDialog); openSetup(); break;
                        case 3: showHelp(); break;
                        case 4: dismissDialog(optionsDialog); finishAffinity(); break;
                    }
                })
                .create();
        optionsDialog.show();
    }

    private void showHelp() {
        helpDialog = new AlertDialog.Builder(this)
                .setTitle(R.string.menu_help)
                .setMessage(R.string.help_text)
                .setPositiveButton(R.string.ok, null)
                .create();
        helpDialog.show();
    }

    private void openSetup() {
        Intent i = new Intent(this, SetupActivity.class);
        i.putExtra(SetupActivity.EXTRA_FORCE, true);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
        finish();
    }

    private void showError() {
        progress.setVisibility(View.GONE);
        errorOverlay.setVisibility(View.VISIBLE);
        findViewById(R.id.error_retry).requestFocus();
    }

    private void hideError() {
        errorOverlay.setVisibility(View.GONE);
        webView.requestFocus();
    }

    private static void dismissDialog(AlertDialog d) {
        if (d != null && d.isShowing()) d.dismiss();
    }

    private String loadAsset(String name) {
        try (InputStream is = getAssets().open(name)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    // ---- Lifecycle -----------------------------------------------------------------

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(allowSleep);
        ui.removeCallbacks(backLongPress);
        dismissDialog(optionsDialog);
        dismissDialog(sslDialog);
        dismissDialog(helpDialog);
        dismissDialog(coachDialog);
        optionsDialog = sslDialog = helpDialog = coachDialog = null;
        if (webView != null) {
            CookieManager.getInstance().flush();
            ViewParent parent = webView.getParent();
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
