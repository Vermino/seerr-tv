package com.seerr.tv;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;

import androidx.appcompat.app.AppCompatActivity;

/**
 * First-run screen where the user types the address of their Jellyseerr / Seerr
 * server. The value is stored in SharedPreferences and reused on later launches,
 * so this screen only appears again if the user chooses "Change server".
 */
public class SetupActivity extends AppCompatActivity {

    public static final String PREFS = "seerr_prefs";
    public static final String KEY_URL = "server_url";
    public static final String EXTRA_FORCE = "force_setup";

    private EditText urlInput;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String saved = prefs.getString(KEY_URL, null);
        boolean force = getIntent().getBooleanExtra(EXTRA_FORCE, false);

        // Already configured -> jump straight into the web UI.
        if (!force && !TextUtils.isEmpty(saved)) {
            startActivity(new Intent(this, WebActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_setup);

        urlInput = findViewById(R.id.url_input);
        Button connect = findViewById(R.id.connect_button);

        urlInput.setText(TextUtils.isEmpty(saved) ? "http://" : saved);
        urlInput.setSelection(urlInput.getText().length());
        urlInput.requestFocus();
        // Auto-raise the on-screen keyboard so a remote user can type the URL immediately
        // (TV launchers otherwise leave the IME closed until OK is pressed on the field).
        urlInput.postDelayed(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(urlInput, InputMethodManager.SHOW_IMPLICIT);
        }, 250);

        connect.setOnClickListener(v -> connect());
        urlInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO
                    || actionId == EditorInfo.IME_ACTION_DONE
                    || actionId == EditorInfo.IME_ACTION_NEXT) {
                connect();
                return true;
            }
            return false;
        });
    }

    private void connect() {
        String raw = urlInput.getText().toString().trim();
        if (TextUtils.isEmpty(raw) || raw.equals("http://") || raw.equals("https://")) {
            urlInput.setError(getString(R.string.setup_error_empty));
            return;
        }

        String normalized = normalize(raw);
        Uri parsed = Uri.parse(normalized);
        String scheme = parsed.getScheme();
        if (scheme == null
                || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                || parsed.getHost() == null || parsed.getHost().isEmpty()) {
            urlInput.setError(getString(R.string.setup_error_invalid));
            return;
        }

        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putString(KEY_URL, normalized)
                .apply();

        startActivity(new Intent(this, WebActivity.class));
        finish();
    }

    /** Add a scheme if missing and trim any trailing slashes. */
    static String normalize(String input) {
        String u = input.trim();
        if (!u.matches("(?i)^[a-z]+://.*")) {
            u = "http://" + u;
        }
        while (u.endsWith("/")) {
            u = u.substring(0, u.length() - 1);
        }
        return u;
    }
}
