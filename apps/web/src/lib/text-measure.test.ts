import { describe, expect, it } from 'vitest';

import { TITLE_MAX_CH, estimateMeasure, fitToWidth, type TextMeasure } from './text-measure';

/** 每个字符宽度不同的假量尺：字母 5、汉字 10、"0" 6、"…" 8 */
const fake: TextMeasure = {
  width: (text) =>
    Array.from(text).reduce(
      (sum, c) => sum + (c === '0' ? 6 : c === '…' ? 8 : /[⺀-￿]/.test(c) ? 10 : 5),
      0,
    ),
  ch: 6,
};

describe('fitToWidth：按量出来的宽度截断，不按字符数', () => {
  it('不超过最大宽度的原样返回', () => {
    expect(fitToWidth('abc', 45 * fake.ch, fake)).toEqual({ text: 'abc', width: 15 });
  });

  it('超出时取最长的前缀加省略号，整体不超过最大宽度', () => {
    const max = 50;
    const result = fitToWidth('一二三四五六七八', max, fake);
    expect(result.text).toBe('一二三四…'); // 40 + 8 = 48 ≤ 50，再多一个汉字就 58
    expect(result.width).toBeLessThanOrEqual(max);
  });

  it('同样的最大宽度下，窄字符放得下的字数更多（不是固定字符数）', () => {
    const max = 50;
    const latin = fitToWidth('abcdefghijklmnop', max, fake).text;
    const cjk = fitToWidth('一二三四五六七八九十', max, fake).text;
    expect(Array.from(latin).length).toBeGreaterThan(Array.from(cjk).length);
  });

  it('最大宽度 = 45ch，随字号变化', () => {
    const small = estimateMeasure(12);
    const large = estimateMeasure(16);
    expect(TITLE_MAX_CH * large.ch).toBeCloseTo((TITLE_MAX_CH * small.ch * 16) / 12, 6);
  });
});
