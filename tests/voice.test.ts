import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Android side, stood in for: the speech engine answers when told, the audio focus is logged.
const pending: (() => void)[] = [];
const ducked: boolean[] = [];
vi.mock('@capacitor-community/text-to-speech', () => ({
  QueueStrategy: { Add: 1 },
  TextToSpeech: {
    speak: () => new Promise<void>((done) => pending.push(done)),
    stop: () => Promise.resolve(),
  },
}));
vi.mock('../src/ui/native', () => ({
  isNative: true,
  duckAudio: (on: boolean) => ducked.push(on),
}));

const { nativeVoice } = await import('../src/ui/voice');
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('spoken prompts in the app', () => {
  beforeEach(() => {
    pending.length = 0;
    ducked.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('ducks other audio from the first queued prompt to the end of the last', async () => {
    const voice = nativeVoice('en');
    voice.speak('In 300 metres, turn right.');
    voice.speak('Then turn left.');
    expect(ducked).toEqual([true]);
    pending.shift()!();
    await settle();
    expect(ducked).toEqual([true]);
    pending.shift()!();
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
    pending.shift()!();
    await settle();
    expect(ducked).toEqual([true, false, true]);
    pending.shift()!();
    await settle();
    expect(ducked).toEqual([true, false, true, false]);
  });
});
