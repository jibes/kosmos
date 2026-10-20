import { describe, expect, it } from 'vitest';
import { otherForms, plusCode, postcodeOf } from '../src/core/queryForms';

describe('plus codes', () => {
  it('decodes a full code on the device', () => {
    const p = plusCode('8FVC9G8F+6X')!;
    expect(p.at!.lat).toBeCloseTo(47.365562, 4);
    expect(p.at!.lng).toBeCloseTo(8.52494, 4);
    expect(p.rest).toBe('');
  });

  it('recovers a short code near a reference, keeping the rest of the text', () => {
    const p = plusCode('9G8F+6X Zürich', { lat: 47.4, lng: 8.6 })!;
    expect(p.at!.lat).toBeCloseTo(47.365562, 4);
    expect(p.at!.lng).toBeCloseTo(8.52494, 4);
    expect(p.rest).toBe('Zürich');
    // Without a reference, the place named first.
    expect(plusCode('9G8F+6X Zürich')).toEqual({ at: null, rest: 'Zürich' });
    // Across the edge of the reference's cell: the nearer match.
    const edge = plusCode('CXXX+XX', { lat: 47.99, lng: 8.99 })!;
    expect(Math.abs(edge.at!.lat - 47.99)).toBeLessThan(0.5);
  });

  it('is not fooled by other words with a plus', () => {
    expect(plusCode('C++ meetup')).toBeNull();
    expect(plusCode('Café Einstein')).toBeNull();
  });
});

describe('postcodes', () => {
  it('writes them properly and knows the area they name', () => {
    expect(postcodeOf('d02x285')).toEqual({ code: 'D02 X285', area: 'D02' });
    expect(postcodeOf('A65 F4E2')).toEqual({ code: 'A65 F4E2', area: 'A65' });
    expect(postcodeOf('d6wx285')).toEqual({ code: 'D6W X285', area: 'D6W' });
    expect(postcodeOf('sw1a1aa')).toEqual({ code: 'SW1A 1AA', area: 'SW1A' });
    expect(postcodeOf('EC1A 1BB')).toEqual({ code: 'EC1A 1BB', area: 'EC1A' });
    expect(postcodeOf('k1a0b1')).toEqual({ code: 'K1A 0B1', area: 'K1A' });
    expect(postcodeOf('1012ab')).toEqual({ code: '1012 AB', area: '1012' });
    expect(postcodeOf('1000-001')).toEqual({ code: '1000 001', area: '1000' });
    expect(postcodeOf('Main Street')).toBeNull();
    // A house number and a street, a line and its number: no postcodes.
    expect(postcodeOf('12 Main')).toBeNull();
    expect(postcodeOf('Linie 12')).toBeNull();
    expect(postcodeOf('10117')).toBeNull();
  });
});

describe('other forms', () => {
  it('tries the postcode properly, then its area', () => {
    expect(otherForms('d02x285')).toEqual(['D02 X285', 'D02']);
  });

  it('moves a house number and drops a last word, at most two more asks', () => {
    expect(otherForms('12 Main Street')).toEqual(['Main Street 12', '12 Main']);
    expect(otherForms('Hauptstraße 5 Berlni')).toEqual(['Hauptstraße 5']);
    expect(otherForms('Unter den Linden, Berlin!')).toEqual([
      'Unter den Linden, Berlin',
      'Unter den Linden,',
    ]);
    expect(otherForms('Café')).toEqual([]);
  });
});
