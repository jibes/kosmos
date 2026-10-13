import { describe, expect, it } from 'vitest';
import { angleDiff, headingOf, smoothHeading, travelHeading } from '../src/core/compass';

describe('compass', () => {
  it('turns alpha into a clockwise heading', () => {
    expect(headingOf({ alpha: 0, absolute: true })).toBe(0);
    expect(headingOf({ alpha: 90, absolute: true })).toBe(270);
    expect(headingOf({ alpha: 270, absolute: true })).toBe(90);
  });

  it('corrects for a rotated screen', () => {
    expect(headingOf({ alpha: 0, absolute: true }, 90)).toBe(90);
    expect(headingOf({ alpha: 10, absolute: true }, 270)).toBe(260);
  });

  it('prefers Safari compass heading and ignores relative readings', () => {
    expect(headingOf({ alpha: 123, absolute: false, webkitCompassHeading: 45 })).toBe(45);
    expect(headingOf({ alpha: 123, absolute: false })).toBeNull();
    expect(headingOf({ alpha: null, absolute: true })).toBeNull();
  });

  it('measures the short way round', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
  });

  it('smooths across north without spinning', () => {
    expect(smoothHeading(null, 370)).toBe(10);
    const h = smoothHeading(350, 10, 0.5);
    expect(h).toBe(0);
  });

  it('uses the compass when slow and the course when moving', () => {
    expect(travelHeading(90, 180, 0.5)).toBe(180);
    expect(travelHeading(90, 180, 10)).toBe(90);
    expect(travelHeading(null, 180, 10)).toBe(180);
    expect(travelHeading(90, null, 0)).toBe(90);
  });
});
