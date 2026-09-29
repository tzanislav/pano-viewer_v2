import { describe, expect, it } from 'vitest';
import { photoNameKey, photoNameStem } from './photoName.js';

describe('photo replacement name', () => {
  it('matches the same name across case and supported extensions', () => {
    expect(photoNameKey('  Living Room.JPG ')).toBe(photoNameKey('living room.png'));
    expect(photoNameStem('Living Room.JPG')).toBe('Living Room');
  });

  it('rejects path-like names', () => {
    expect(() => photoNameKey('../room.jpg')).toThrow(RangeError);
  });
});
