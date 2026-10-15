package io.github.jibes.kosmos;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The app's own small native helpers: its page in the system settings (where a refused location
 * permission is allowed again), other audio ducking under spoken prompts, and a log line under
 * its own tag. Release builds forward nothing
 * else from the WebView to the system log, so no position ever ends up there; the CI smoke test
 * reads the "loaded" line and web errors from this tag.
 */
@CapacitorPlugin(name = "Kosmos")
public class KosmosPlugin extends Plugin {

    private static final String TAG = "kOSMos";

    /** Held while prompts speak: music and podcasts duck under them, as for any navigation. */
    private AudioFocusRequest focus;

    /** The app's page in the settings, else the settings at all (some builds have no page). */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent page = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null)
        );
        for (Intent intent : new Intent[] { page, new Intent(Settings.ACTION_SETTINGS) }) {
            try {
                getContext().startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                call.resolve();
                return;
            } catch (ActivityNotFoundException e) {
                Log.w(TAG, "no settings screen for " + intent.getAction());
            }
        }
        call.reject("No settings screen", "UNAVAILABLE");
    }

    @PluginMethod
    public void duck(PluginCall call) {
        AudioManager audio = getContext().getSystemService(AudioManager.class);
        if (Boolean.TRUE.equals(call.getBoolean("on", false))) {
            if (focus == null) {
                AudioAttributes guidance = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(guidance)
                    .build();
                audio.requestAudioFocus(focus);
            }
        } else if (focus != null) {
            audio.abandonAudioFocusRequest(focus);
            focus = null;
        }
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
