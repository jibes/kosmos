import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech';
import { useCallback, useRef, useState } from 'react';
import type { TravelMode } from '../core/route';
import { duckAudio, isNative } from './native';
import { MUTED_KEY, store, storedMuted } from './prefs';
import { logEvent } from './usageLog';

/** Spoken guidance. Web Speech in browsers; the system engine (Google's voices) on Android. */
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
 * Android's own speech engine: natural voices, offline, and it keeps talking in the background.
 * Music and podcasts duck while it speaks, from the first queued prompt to the end of the last.
 */
export function nativeVoice(lang: string): Voice {
  let speaking = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    speaking = 0;
    clearTimeout(watchdog);
    duckAudio(false);
  };
  return {
    speak(text) {
      if (speaking++ === 0) duckAudio(true);
      clearTimeout(watchdog);
      watchdog = setTimeout(release, DUCK_MAX_MS);
      void TextToSpeech.speak({ text, lang, rate: 1, queueStrategy: QueueStrategy.Add })
        .catch(() => undefined)
        .finally(() => {
          if (speaking > 0 && --speaking === 0) release();
        });
    },
    stop() {
      void TextToSpeech.stop().catch(() => undefined);
      release();
    },
  };
}

export const systemVoice = (lang: string): Voice => (isNative ? nativeVoice(lang) : webVoice(lang));

/**
 * Voice on or off while guiding. Driving keeps the choice for the next drive; on foot, by bike
 * and on public transport, among other people, every trip starts silent and a tap speaks for
 * that trip only.
 */
export function useMuted(voice: Voice) {
  const [muted, setMuted] = useState(true);
  const driving = useRef(false);
  /** Guidance starts in `mode`. */
  const begin = useCallback((mode: TravelMode) => {
    driving.current = mode === 'car';
    setMuted(driving.current ? storedMuted() : true);
  }, []);
  const toggle = useCallback(() => {
    const now = !muted;
    logEvent('voice.mute', { muted: now, driving: driving.current });
    setMuted(now);
    if (driving.current) store(MUTED_KEY, now ? '1' : '0');
    if (now) voice.stop();
  }, [muted, voice]);
  return { muted, begin, toggle };
}
