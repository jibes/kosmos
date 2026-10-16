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
import android.os.Build;
import android.os.SystemClock;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The app's own small native helpers: its page in the system settings (where a refused location
 * permission is allowed again), other audio ducking under spoken prompts, the ambient light
 * while guiding (for the map's theme), a buzz for a turn when the voice is off, a place opened
 * or shared from another app, and a log line under its own tag. Release builds forward nothing
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

    /**
     * A buzz for a turn, as milliseconds on and off in turn. Marked as accessibility feedback
     * (Android 13+): guidance for someone who cannot listen, which the system's own vibration
     * settings still govern.
     */
    @PluginMethod
    public void vibrate(PluginCall call) {
        JSArray pattern = call.getArray("pattern", new JSArray());
        long[] timings = new long[pattern.length() + 1];
        try {
            for (int i = 0; i < pattern.length(); i++) timings[i + 1] = Math.max(0, pattern.getLong(i));
        } catch (org.json.JSONException e) {
            call.reject("Bad pattern", "BAD_PATTERN");
            return;
        }
        Vibrator vibrator = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? getContext().getSystemService(VibratorManager.class).getDefaultVibrator()
            : getContext().getSystemService(Vibrator.class);
        if (vibrator == null || !vibrator.hasVibrator() || timings.length < 2) {
            call.resolve();
            return;
        }
        VibrationEffect effect = VibrationEffect.createWaveform(timings, -1);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ACCESSIBILITY));
        } else {
            vibrator.vibrate(effect);
        }
        call.resolve();
    }

    /**
     * What another app handed over: a link it opened here (geo:, a map link), or the text of a
     * message it shared (a place's name, address and link). The web app reads the place.
     */
    private static String sharedText(Intent intent) {
        if (intent == null) return null;
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            return intent.getData().toString();
        }
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text == null) return subject;
            return subject != null && !text.contains(subject) ? subject + "\n" + text : text;
        }
        return null;
    }

    /** The place the app was opened with, once: taken, it is not handed over again. */
    @PluginMethod
    public void takeShared(PluginCall call) {
        String text = sharedText(getActivity().getIntent());
        if (text != null) getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        JSObject result = new JSObject();
        if (text != null) result.put("text", text);
        call.resolve(result);
    }

    /** A place handed over while the app runs. */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        String text = sharedText(intent);
        if (text == null) return;
        JSObject data = new JSObject();
        data.put("text", text);
        notifyListeners("shared", data, true);
    }
}
