import { useCallback, useRef, useState } from 'react';
import type { TravelMode } from '../core/route';
import { duckAudio, isNative, nativeLog, speak, stopSpeaking } from './native';
import { MUTED_KEY, store, storedMuted } from './prefs';
import { logEvent } from './usageLog';

/** Spoken guidance. Web Speech in browsers; on Android the speech engine the user chose. */
export interface Voice {
  speak(text: string): void;
  stop(): void;
}

// Looked up per call: the engine can appear late (some browsers) or be replaced (tests).
const synth = () => (typeof speechSynthesis === 'undefined' ? null : speechSynthesis);

export function webVoice(lang: string): Voice {
  return {
    speak(text) {
      const s = synth();
      if (!s) return;
      // Queued, never cut off: the opening words and the first prompt often come together. A
      // queue stuck behind nothing (some engines stall) is cleared first.
      if (!s.speaking && s.pending) s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 1.02;
      s.speak(u);
    },
    stop() {
      synth()?.cancel();
    },
  };
}

/** A prompt that has not finished by now never will: other audio comes back regardless. */
const DUCK_MAX_MS = 20_000;

/**
 * The speech engine the user chose in Android's settings (Google's, or one such as HayaiTTS):
 * natural voices, offline, and it keeps talking in the background (`KosmosPlugin.speak`).
 * Music and podcasts duck while it speaks, from the first queued prompt to the end of the last.
 */
export function nativeVoice(lang: string): Voice {
  let speaking = 0;
  /** Bumped by every release: a prompt from before it (stopped, or past the watchdog) no longer
   * counts, so its late end cannot lift the ducking under a prompt spoken since. */
  let round = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    speaking = 0;
    round++;
    clearTimeout(watchdog);
    duckAudio(false);
  };
  return {
    speak(text) {
      if (speaking++ === 0) duckAudio(true);
      const mine = round;
      clearTimeout(watchdog);
      watchdog = setTimeout(release, DUCK_MAX_MS);
      void speak(text, lang)
        .catch((e: unknown) => nativeLog('error', `prompt not spoken: ${String(e)}`))
        .finally(() => {
          if (mine === round && --speaking === 0) release();
        });
    },
    stop() {
      stopSpeaking();
      release();
    },
  };
}

export const systemVoice = (lang: string): Voice => (isNative ? nativeVoice(lang) : webVoice(lang));

/**
 * Voice on or off while guiding: one choice, kept for the next trip however it goes (on at
 * first). Muted on foot or by bike, prompts buzz instead (`core/haptics.ts`).
 */
export function useMuted(voice: Voice) {
  const [muted, setMuted] = useState(storedMuted);
  const mode = useRef<TravelMode>('car');
  /** Guidance starts in `mode`: as the voice was left. */
  const begin = useCallback((m: TravelMode) => {
    mode.current = m;
    setMuted(storedMuted());
  }, []);
  const toggle = useCallback(() => {
    const now = !muted;
    logEvent('voice.mute', { muted: now, mode: mode.current });
    setMuted(now);
    store(MUTED_KEY, now ? '1' : '0');
    if (now) voice.stop();
  }, [muted, voice]);
  return { muted, begin, toggle };
}
