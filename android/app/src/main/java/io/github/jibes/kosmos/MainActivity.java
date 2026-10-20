package io.github.jibes.kosmos;

import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KosmosPlugin.class);
        registerPlugin(NavLocationPlugin.class);
        super.onCreate(savedInstanceState);
        // The page runs in WebView's own renderer process, which by default drops to the lowest
        // priority while the app is not on screen; the system then freezes it after a while, and
        // guidance (location keeps coming to the foreground service) goes silent until the app
        // is opened again, when every queued prompt speaks at once. Kept at the app's own
        // priority instead: high while guiding (the foreground service), low otherwise.
        WebView web = getBridge().getWebView();
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
    }

    /** Guiding: leaving the app (Home, another app) shrinks it to a small window instead. */
    private boolean pip;

    /** Picture-in-picture allowed now or not (`KosmosPlugin.pip`, while guiding). */
    void setPip(boolean on) {
        pip = on;
        // Android 12+ enters by itself on the way home, animated from the app's own frame.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setPictureInPictureParams(pipParams());
    }

    /** Portrait, as the banner over the map reads best upright. */
    private PictureInPictureParams pipParams() {
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational(3, 4));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.setAutoEnterEnabled(pip).setSeamlessResizeEnabled(false);
        }
        return b.build();
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Before Android 12 the app asks itself, as the user leaves it.
        if (pip && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            try {
                enterPictureInPictureMode(pipParams());
            } catch (IllegalStateException e) {
                // Turned off for the app in the system settings: it simply goes to the background.
            }
        }
    }

    /** The page lays itself out small (only the next turn and the map) or as before. */
    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPip, newConfig);
        if (getBridge() != null) getBridge().triggerWindowJSEvent("kosmospip", "{ \"on\": " + inPip + " }");
    }

    /** Out of sight or back: the page, kept running while guiding, draws nothing meanwhile. */
    private void away(boolean out) {
        if (getBridge() != null) getBridge().triggerWindowJSEvent("kosmosaway", "{ \"away\": " + out + " }");
    }

    @Override
    public void onStart() {
        super.onStart();
        away(false);
    }

    @Override
    public void onStop() {
        super.onStop();
        away(true);
    }
}
