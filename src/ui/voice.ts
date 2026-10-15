import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech';
import { useCallback, useRef, useState } from 'react';
import type { TravelMode } from '../core/route';
import { isNative } from './native';
import { MUTED_KEY, store, storedMuted } from './prefs';

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
      s.cancel();
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

/** Android's own speech engine: natural voices, offline, and it keeps talking in the background. */
export function nativeVoice(lang: string): Voice {
  return {
    speak(text) {
      void TextToSpeech.speak({ text, lang, rate: 1, queueStrategy: QueueStrategy.Flush }).catch(
        () => undefined,
      );
    },
    stop() {
      void TextToSpeech.stop().catch(() => undefined);
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
    setMuted(now);
    if (driving.current) store(MUTED_KEY, now ? '1' : '0');
    if (now) voice.stop();
  }, [muted, voice]);
  return { muted, begin, toggle };
}
