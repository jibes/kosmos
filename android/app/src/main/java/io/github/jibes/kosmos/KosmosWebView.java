package io.github.jibes.kosmos;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

/**
 * Capacitor's WebView, which tells the page it is still shown while guiding: out of sight (the
 * app put away, the screen off) the page counts as hidden, and the system then throttles and
 * freezes it, so fixes from the location service waited and no turn was said until the app was
 * opened again. Whether it is really seen comes to the page as its own event (`kosmosaway`,
 * `MainActivity`), so it draws nothing meanwhile.
 */
public class KosmosWebView extends CapacitorWebView {

    private boolean keepRunning;

    public KosmosWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    /** On while guiding (`KosmosPlugin.keepRunning`); off, the page is hidden as it really is. */
    void keepRunning(boolean on) {
        if (keepRunning == on) return;
        keepRunning = on;
        onWindowVisibilityChanged(getWindowVisibility());
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(keepRunning ? View.VISIBLE : visibility);
    }
}
