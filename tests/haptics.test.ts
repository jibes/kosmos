import { describe, expect, it } from 'vitest';
import { BUZZ, buzzFor } from '../src/core/haptics';

const p = (key: string) => ({ key, text: '' });

describe('turn buzzes', () => {
  it('buzzes once ahead, twice at the turn, long on arrival, on foot and by bike', () => {
    expect(buzzFor(p('2:alert'), 'foot', true, 5)).toEqual(BUZZ.ahead);
    expect(buzzFor(p('2:pre'), 'bike', true, 5)).toEqual(BUZZ.now);
    expect(buzzFor(p('5:pre'), 'foot', true, 5)).toEqual(BUZZ.arrive);
  });

  it('stays still for "continue", with the voice on, and in a car', () => {
    expect(buzzFor(p('2:post'), 'foot', true, 5)).toBeNull();
    expect(buzzFor(p('2:pre'), 'foot', false, 5)).toBeNull();
    expect(buzzFor(p('2:pre'), 'car', true, 5)).toBeNull();
  });
});
