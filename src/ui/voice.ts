import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech';
import { isNative } from './native';

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
