package io.github.jibes.kosmos;

import android.Manifest;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Location for guidance through {@link NavLocationService}. Asks for location (precise or
 * approximate, either will do) and, from Android 13, for the notification that shows guidance
 * is running; then starts the service and passes every fix on as a "location" event.
 */
@CapacitorPlugin(
    name = "NavLocation",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }
        ),
        @Permission(alias = "coarseLocation", strings = { Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class NavLocationPlugin extends Plugin {

    @Override
    public void load() {
        NavLocationService.sink = this::emit;
    }

    @Override
    protected void handleOnDestroy() {
        NavLocationService.sink = null;
        getContext().stopService(new Intent(getContext(), NavLocationService.class));
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("coarseLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterLocation");
            return;
        }
        askNotifications(call);
    }

    @PermissionCallback
    private void afterLocation(PluginCall call) {
        if (getPermissionState("coarseLocation") != PermissionState.GRANTED) {
            call.reject("Location permission denied", "NOT_AUTHORIZED");
            return;
        }
        askNotifications(call);
    }

    /** Asked once: after a refusal Android will not show the question again anyway. */
    private void askNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PermissionState state = getPermissionState("notifications");
            if (state == PermissionState.PROMPT || state == PermissionState.PROMPT_WITH_RATIONALE) {
                requestPermissionForAlias("notifications", call, "afterNotifications");
                return;
            }
        }
        run(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        // Without the notification guidance still runs; Android just does not show it.
        run(call);
    }

    private void run(PluginCall call) {
        Intent intent = new Intent(getContext(), NavLocationService.class)
            .putExtra(NavLocationService.EXTRA_TITLE, call.getString("title", "kOSMos"))
            .putExtra(NavLocationService.EXTRA_TEXT, call.getString("text", ""));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject(e.getMessage(), "START_FAILED");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), NavLocationService.class));
        call.resolve();
    }

    private void emit(Location location) {
        JSObject fix = new JSObject();
        fix.put("lng", location.getLongitude());
        fix.put("lat", location.getLatitude());
        fix.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 50.0);
        if (location.hasSpeed()) fix.put("speed", location.getSpeed());
        if (location.hasBearing()) fix.put("bearing", location.getBearing());
        // The phone's clock at the moment of the fix (as Date.now() counts), not the GPS time:
        // freshness is judged against the phone's clock.
        long ageMs = (SystemClock.elapsedRealtimeNanos() - location.getElapsedRealtimeNanos()) / 1_000_000;
        fix.put("time", System.currentTimeMillis() - Math.max(0, ageMs));
        notifyListeners("location", fix);
    }
}
