import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.jibes.kosmos',
  appName: 'kOSMos',
  webDir: 'dist',
  // The WebView's console and the bridge's traffic (positions included) reach the system log in
  // debug builds only. Release builds log through KosmosPlugin.java: the "kosmos:ready" line and
  // web errors, which the CI smoke test reads.
  loggingBehavior: 'debug',
  server: {
    // Shown instead of a blank map where the WebView is too old (see minWebViewVersion).
    errorPath: 'webview.html',
  },
  android: {
    backgroundColor: '#121417',
    // MapLibre needs WebGL 2 and the bundle targets ES2022: Chrome 100 or newer.
    minWebViewVersion: 100,
  },
};

export default config;
