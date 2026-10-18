package io.github.jibes.kosmos;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The app's own small native helpers: its page in the system settings (where a refused location
 * permission is allowed again), other audio ducking under spoken prompts, a buzz for a turn
 * when the voice is off, the usage log handed to the share sheet, a place opened
 * or shared from another app, and a log line under its own tag. Release builds forward nothing
 * else from the WebView to the system log, so no position ever ends up there; the CI smoke test
 * reads the "loaded" line and web errors from this tag.
 */
@CapacitorPlugin(
    name = "Kosmos",
    permissions = { @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts") }
)
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

    /** Addresses read at most: an address book can be long, the map need not show it all. */
    private static final int CONTACTS_MAX = 500;

    /**
     * The contacts with a postal address: their name and the address as written. Asked for with
     * `ask`, the permission is requested first; without, an address book not yet allowed gives
     * `allowed: false` and nothing else. Nothing leaves the phone from here.
     */
    @PluginMethod
    public void contacts(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            call.resolve(readContacts());
        } else if (Boolean.TRUE.equals(call.getBoolean("ask", false))) {
            requestPermissionForAlias("contacts", call, "contactsAnswered");
        } else {
            JSObject none = new JSObject();
            none.put("allowed", false);
            call.resolve(none);
        }
    }

    @PermissionCallback
    private void contactsAnswered(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            call.resolve(readContacts());
        } else {
            JSObject none = new JSObject();
            none.put("allowed", false);
            call.resolve(none);
        }
    }

    private JSObject readContacts() {
        JSArray list = new JSArray();
        String[] columns = {
            ContactsContract.CommonDataKinds.StructuredPostal.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.StructuredPostal.FORMATTED_ADDRESS,
        };
        try (
            Cursor c = getContext()
                .getContentResolver()
                .query(ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_URI, columns, null, null, null)
        ) {
            while (c != null && c.moveToNext() && list.length() < CONTACTS_MAX) {
                String name = c.getString(0);
                String address = c.getString(1);
                if (name == null || address == null) continue;
                JSObject one = new JSObject();
                one.put("name", name);
                one.put("address", address);
                list.put(one);
            }
        } catch (SecurityException e) {
            Log.w(TAG, "contacts not readable", e);
        }
        JSObject result = new JSObject();
        result.put("allowed", true);
        result.put("contacts", list);
        return result;
    }

    /**
     * The usage log handed to the share sheet as a file (Save to Files, Drive, another app):
     * written to the cache, shared by a content link that only the chosen app may read.
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "kosmos-log.txt");
        String text = call.getString("text", "");
        File dir = new File(getContext().getCacheDir(), "logs");
        File file = new File(dir, name.replaceAll("[^\\w.-]", "_"));
        try {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no cache dir");
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, name)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (IOException | IllegalArgumentException | ActivityNotFoundException e) {
            Log.w(TAG, "could not share the log", e);
            call.reject("Could not share", "UNAVAILABLE");
        }
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
