/** Spoken guidance. Web Speech in browsers; the Android app swaps in a native engine. */
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
