package io.github.jibes.kosmos;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The app's own small native helpers: its page in the system settings (where a refused location
 * permission is allowed again), other audio ducking under spoken prompts, the ambient light
 * while guiding (for the map's theme), and a log line under its own tag. Release builds forward nothing
 * else from the WebView to the system log, so no position ever ends up there; the CI smoke test
 * reads the "loaded" line and web errors from this tag.
 */
@CapacitorPlugin(name = "Kosmos")
public class KosmosPlugin extends Plugin {

    private static final String TAG = "kOSMos";

    /** Held while prompts speak: music and podcasts duck under them, as for any navigation. */
    private AudioFocusRequest focus;

    /** One light reading a second is plenty: the theme waits seconds before it changes. */
    private static final long LIGHT_EVERY_MS = 1000;

    /** Asked for by the web app (while guiding); listened to only while the app is in front. */
    private boolean lightWanted;
    private boolean lightListening;
    private long lightSent;

    private final SensorEventListener light = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            long now = SystemClock.elapsedRealtime();
            if (now - lightSent < LIGHT_EVERY_MS) return;
            lightSent = now;
            JSObject data = new JSObject();
            data.put("lux", event.values[0]);
            notifyListeners("light", data);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

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

    /** Starts or stops the light readings; `available` is false on phones without the sensor. */
    @PluginMethod
    public void light(PluginCall call) {
        lightWanted = Boolean.TRUE.equals(call.getBoolean("on", false));
        listenLight(lightWanted);
        JSObject result = new JSObject();
        result.put("available", sensor() != null);
        call.resolve(result);
    }

    private Sensor sensor() {
        SensorManager sensors = getContext().getSystemService(SensorManager.class);
        return sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_LIGHT);
    }

    private void listenLight(boolean on) {
        SensorManager sensors = getContext().getSystemService(SensorManager.class);
        Sensor sensor = sensor();
        if (sensors == null || sensor == null) return;
        if (on && !lightListening) {
            lightSent = 0;
            lightListening = sensors.registerListener(light, sensor, SensorManager.SENSOR_DELAY_NORMAL);
        } else if (!on && lightListening) {
            sensors.unregisterListener(light);
            lightListening = false;
        }
    }

    @Override
    protected void handleOnPause() {
        listenLight(false);
    }

    @Override
    protected void handleOnResume() {
        if (lightWanted) listenLight(true);
    }

    @Override
    protected void handleOnDestroy() {
        listenLight(false);
    }
}
