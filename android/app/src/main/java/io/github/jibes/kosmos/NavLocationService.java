package io.github.jibes.kosmos;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.util.function.Consumer;

/**
 * Keeps location coming while guiding, also with the screen off or another app in front: a
 * foreground service with the platform's own LocationManager (GPS, and the network where GPS is
 * off or only approximate location is allowed). No Google Play services, so it works on any
 * Android.
 */
public class NavLocationService extends Service implements LocationListener {

    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    private static final String TAG = "kOSMos";
    private static final String CHANNEL = "navigation";
    private static final int NOTIFICATION_ID = 7051;
    /** A GPS fix this recent makes the coarser network fixes noise. */
    private static final long GPS_FRESH_MS = 10_000;

    /** Where fixes go: the plugin, while the app runs. */
    static volatile Consumer<Location> sink;

    private LocationManager manager;
    private long lastGps;
    /** The first fix is logged (its provider, never the position): CI checks that fixes come. */
    private boolean announced;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable relisten = this::listen;

    /**
     * Location or a provider switched on or off. A request made while location was off stays
     * inactive once it is switched on (Android 16 at least), so the providers are asked anew;
     * a burst of these broadcasts asks once.
     */
    private final BroadcastReceiver switched = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            listenAgain();
        }
    };

    private void listenAgain() {
        main.removeCallbacks(relisten);
        main.postDelayed(relisten, 500);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        IntentFilter filter = new IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION);
        filter.addAction(LocationManager.MODE_CHANGED_ACTION);
        ContextCompat.registerReceiver(this, switched, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        try {
            Notification notification = notification(
                title != null ? title : getString(R.string.app_name),
                text != null ? text : ""
            );
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (RuntimeException e) {
            // Refused (for example without a location permission): fixes still come while the app
            // is in front, which is what the web watch would have done anyway.
            Log.w(TAG, "navigation service not in the foreground", e);
        }
        listen();
        return START_NOT_STICKY;
    }

    private Notification notification(String title, String text) {
        NotificationManager notifications = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL,
            getString(R.string.navigation_channel),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setShowBadge(false);
        notifications.createNotificationChannel(channel);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent back = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_navigation)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(back)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private boolean allowed(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Asks each provider the permission allows for a fix a second, switched on or not: one
     * switched on later (location or GPS turned on mid-trip) then starts by itself. GPS needs
     * precise location; a phone without a network provider simply has none.
     */
    private void listen() {
        if (manager == null) manager = getSystemService(LocationManager.class);
        manager.removeUpdates(this);
        boolean fine = allowed(Manifest.permission.ACCESS_FINE_LOCATION);
        boolean coarse = fine || allowed(Manifest.permission.ACCESS_COARSE_LOCATION);
        if (fine) request(LocationManager.GPS_PROVIDER, 1000);
        if (coarse) request(LocationManager.NETWORK_PROVIDER, 2000);
    }

    /** One provider: its failure (missing on this phone, refused) leaves the other one asked. */
    private void request(String provider, long intervalMs) {
        try {
            manager.requestLocationUpdates(provider, intervalMs, 0, this, Looper.getMainLooper());
        } catch (SecurityException | IllegalArgumentException e) {
            Log.w(TAG, "no location updates from " + provider, e);
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (!announced) {
            announced = true;
            Log.i(TAG, "navigation: first fix from " + location.getProvider());
        }
        long now = SystemClock.elapsedRealtime();
        if (LocationManager.GPS_PROVIDER.equals(location.getProvider())) {
            lastGps = now;
        } else if (lastGps != 0 && now - lastGps < GPS_FRESH_MS) {
            return;
        }
        Consumer<Location> to = sink;
        if (to != null) to.accept(location);
    }

    // Spelled out: these are abstract on Android 8 and 9, where a missing one crashes the call.
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {
        listenAgain();
    }

    @Override
    public void onProviderDisabled(String provider) {}

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The app was swiped away: guidance is over, so is the service.
        stopSelf();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(relisten);
        unregisterReceiver(switched);
        if (manager != null) manager.removeUpdates(this);
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
