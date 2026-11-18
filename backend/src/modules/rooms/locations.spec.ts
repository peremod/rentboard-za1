import { describe, it, expect } from 'vitest';
import {
  PROVINCES,
  LOCATION_PAGE_MIN_ROOMS,
  provinceSlug,
  provinceFromSlug,
  publishedFromCounts,
} from './locations';
import { SA_PROVINCES } from './dto/room-filters.dto';

describe('location-page gate and slugs', () => {
  it('the province list matches the filter DTO, so a rename cannot diverge', () => {
    expect([...PROVINCES]).toEqual([...SA_PROVINCES]);
  });

  describe('slug ⇆ province is a stable round-trip', () => {
    it.each(PROVINCES)('%s round-trips through its slug', (province) => {
      expect(provinceFromSlug(provinceSlug(province))).toBe(province);
    });

    it('uses the spellings crawlable URLs depend on', () => {
      expect(provinceSlug('Gauteng')).toBe('gauteng');
      expect(provinceSlug('KwaZulu-Natal')).toBe('kwazulu-natal');
      expect(provinceSlug('North West')).toBe('north-west');
      expect(provinceSlug('Western Cape')).toBe('western-cape');
    });

    it('rejects a slug that names no province', () => {
      expect(provinceFromSlug('atlantis')).toBeNull();
      expect(provinceFromSlug('')).toBeNull();
      // A city is not a province, and this cut does not publish city pages.
      expect(provinceFromSlug('soweto')).toBeNull();
    });
  });

  describe('publishedFromCounts — the gate', () => {
    it('publishes a province AT the threshold and excludes one just below', () => {
      const published = publishedFromCounts([
        { province: 'Gauteng', count: LOCATION_PAGE_MIN_ROOMS },
        { province: 'Free State', count: LOCATION_PAGE_MIN_ROOMS - 1 },
      ]);
      expect(published.map((p) => p.province)).toEqual(['Gauteng']);
    });

    it('is the real gate: a province one room short does NOT publish', () => {
      // The check that must be able to fail. If the threshold comparison were
      // `>` instead of `>=`, Gauteng at exactly 3 would wrongly drop out; if it
      // were `count > 0`, Free State at 2 would wrongly appear. Both are caught.
      const atLine = publishedFromCounts([{ province: 'Gauteng', count: 3 }]);
      const belowLine = publishedFromCounts([{ province: 'Free State', count: 2 }]);
      expect(atLine).toHaveLength(1);
      expect(belowLine).toHaveLength(0);
    });

    it('orders by inventory, highest first, then alphabetically', () => {
      const published = publishedFromCounts([
        { province: 'Western Cape', count: 10 },
        { province: 'Gauteng', count: 40 },
        { province: 'Limpopo', count: 10 },
      ]);
      expect(published.map((p) => p.province)).toEqual(['Gauteng', 'Limpopo', 'Western Cape']);
    });

    it('drops null provinces and unknown spellings rather than publishing junk', () => {
      const published = publishedFromCounts([
        { province: null, count: 99 },
        { province: 'Gautng', count: 99 }, // typo — not a real province
        { province: 'Gauteng', count: 5 },
      ]);
      expect(published.map((p) => p.province)).toEqual(['Gauteng']);
    });
  });
});
