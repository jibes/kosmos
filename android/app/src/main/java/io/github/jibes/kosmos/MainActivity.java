package io.github.jibes.kosmos;

import android.os.Bundle;
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
}
