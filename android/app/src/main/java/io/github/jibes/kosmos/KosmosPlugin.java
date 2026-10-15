package io.github.jibes.kosmos;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The app's own small native helpers: its page in the system settings (where a refused location
 * permission is allowed again), and a log line under its own tag. Release builds forward nothing
 * else from the WebView to the system log, so no position ever ends up there; the CI smoke test
 * reads the "loaded" line and web errors from this tag.
 */
@CapacitorPlugin(name = "Kosmos")
public class KosmosPlugin extends Plugin {

    private static final String TAG = "kOSMos";

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null)
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void log(PluginCall call) {
        String message = call.getString("message", "");
        if ("error".equals(call.getString("level"))) Log.e(TAG, message);
        else Log.i(TAG, message);
        call.resolve();
    }
}
