import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Android side, stood in for: the speech engine answers when told, the audio focus and the
// log are kept.
const pending: { done: () => void; fail: (e: Error) => void }[] = [];
const ducked: boolean[] = [];
const logged: string[] = [];
const asked: { text: string; lang: string }[] = [];
vi.mock('../src/ui/native', () => ({
  isNative: true,
  duckAudio: (on: boolean) => ducked.push(on),
  nativeLog: (_level: string, message: string) => logged.push(message),
  speak: (text: string, lang: string) => {
    asked.push({ text, lang });
    return new Promise<void>((done, fail) => pending.push({ done, fail }));
  },
  stopSpeaking: () => undefined,
}));

const { nativeVoice } = await import('../src/ui/voice');
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('spoken prompts in the app', () => {
  beforeEach(() => {
    pending.length = 0;
    ducked.length = 0;
    logged.length = 0;
    asked.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('ducks other audio from the first queued prompt to the end of the last', async () => {
    const voice = nativeVoice('en');
    voice.speak('In 300 metres, turn right.');
    voice.speak('Then turn left.');
    expect(ducked).toEqual([true]);
    pending.shift()!.done();
    await settle();
    expect(ducked).toEqual([true]);
    pending.shift()!.done();
    await settle();
    expect(ducked).toEqual([true, false]);
  });

  it('gives the audio back at once when stopped', () => {
    const voice = nativeVoice('en');
    voice.speak('Turn right.');
    voice.stop();
    expect(ducked).toEqual([true, false]);
  });

  it('gives the audio back even when the engine never says it is done', () => {
    vi.useFakeTimers();
    const voice = nativeVoice('en');
    voice.speak('Turn right.');
    vi.advanceTimersByTime(25_000);
    expect(ducked).toEqual([true, false]);
  });

  it('keeps ducking under a new prompt when one stopped before ends late', async () => {
    const voice = nativeVoice('en');
    voice.speak('Turn right.');
    voice.stop();
    voice.speak('Rerouting: turn left.');
    expect(ducked).toEqual([true, false, true]);
    // The stopped prompt's engine call only now settles: the new one still speaks.
    pending.shift()!.done();
    await settle();
    expect(ducked).toEqual([true, false, true]);
    pending.shift()!.done();
    await settle();
    expect(ducked).toEqual([true, false, true, false]);
  });

  it('hands the prompt and its language to the engine', () => {
    nativeVoice('de-DE').speak('In 300 Metern rechts abbiegen.');
    expect(asked).toEqual([{ text: 'In 300 Metern rechts abbiegen.', lang: 'de-DE' }]);
  });

  it('logs a prompt the engine could not say, and gives the audio back', async () => {
    const voice = nativeVoice('de-DE');
    voice.speak('Rechts abbiegen.');
    pending.shift()!.fail(new Error('No speech engine'));
    await settle();
    expect(ducked).toEqual([true, false]);
    expect(logged).toEqual(['prompt not spoken: Error: No speech engine']);
  });
});
