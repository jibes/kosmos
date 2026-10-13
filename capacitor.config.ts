import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.jibes.kosmos',
  appName: 'kOSMos',
  webDir: 'dist',
  // Web console output reaches logcat in release builds too, so the CI emulator smoke test can
  // see web errors and the "kosmos:ready" line.
  loggingBehavior: 'production',
  android: {
    backgroundColor: '#121417',
  },
};

export default config;
