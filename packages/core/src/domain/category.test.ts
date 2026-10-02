import { describe, expect, it } from 'vitest';

import { DEFAULT_CATEGORY_PALETTE, defaultPaletteColor } from './category';

describe('默认颜色', () => {
  it('取调色板里还没用过的第一个', () => {
    expect(defaultPaletteColor([])).toBe(DEFAULT_CATEGORY_PALETTE[0]);
    expect(defaultPaletteColor([DEFAULT_CATEGORY_PALETTE[0].toLowerCase()])).toBe(
      DEFAULT_CATEGORY_PALETTE[1],
    );
  });

  it('全都用过了就从头开始依次轮换', () => {
    const all = [...DEFAULT_CATEGORY_PALETTE];
    expect(defaultPaletteColor(all)).toBe(DEFAULT_CATEGORY_PALETTE[0]);
    expect(defaultPaletteColor([...all, DEFAULT_CATEGORY_PALETTE[0]])).toBe(
      DEFAULT_CATEGORY_PALETTE[1],
    );
  });
});
