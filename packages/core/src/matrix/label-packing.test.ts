import { describe, expect, it } from 'vitest';

import { laneCenters, packBandLabels, type BandSpec, type LabelRequest } from './label-packing';

const band: BandSpec = { top: 0, height: 100, laneHeight: 20, padding: 5, gap: 4 };

/** 一个 100 宽的格子：[200, 300] */
const req = (item: string, extra: Partial<LabelRequest<string>> = {}): LabelRequest<string> => ({
  item,
  minX: 200,
  maxX: 300,
  desiredX: 250,
  desiredY: 50,
  widths: [80, 40, 10],
  priority: 0,
  ...extra,
});

const inside = (p: { x: number; width: number }, minX: number, maxX: number) =>
  p.x - p.width / 2 >= minX - 1e-9 && p.x + p.width / 2 <= maxX + 1e-9;

function overlaps(a: { x: number; y: number; width: number }, b: typeof a) {
  return a.y === b.y && Math.abs(a.x - b.x) < (a.width + b.width) / 2;
}

describe('laneCenters', () => {
  it('横带内等分泳道并居中', () => {
    expect(laneCenters(band)).toEqual([20, 40, 60, 80]); // (100 - 2×5) / 20 = 4 条
  });
});

describe('packBandLabels：普通任务的标签整个落在所属格子内', () => {
  it('放在离期望位置最近的地方（格内自由散布）', () => {
    const [a] = packBandLabels([req('a', { desiredX: 230, desiredY: 12 })], band);
    expect(a).toMatchObject({ item: 'a', x: 240, y: 20, width: 80, widthIndex: 0 });
    expect(inside(a!, 200, 300)).toBe(true);
  });

  it('期望位置靠近格子边缘时向内收，不越过刻度线', () => {
    const [a] = packBandLabels([req('a', { desiredX: 299 })], band);
    expect(a!.x + a!.width / 2).toBe(300);
  });

  it('同一格的多个标签分到不同泳道、互不重叠，全部留在格内', () => {
    const placed = packBandLabels(
      Array.from({ length: 4 }, (_, i) => req(`t${i}`)),
      band,
    );
    expect(placed).toHaveLength(4);
    for (const p of placed) expect(inside(p, 200, 300)).toBe(true);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
  });

  it('泳道满了改用更短的宽度，同一泳道并排，仍在格内', () => {
    const placed = packBandLabels(
      Array.from({ length: 8 }, (_, i) => req(`t${i}`, { widths: [45, 20, 8] })),
      band,
    );
    expect(placed).toHaveLength(8);
    expect(placed.filter((p) => p.widthIndex === 0)).toHaveLength(4);
    expect(placed.filter((p) => p.widthIndex === 1)).toHaveLength(4);
    for (const p of placed) expect(inside(p, 200, 300)).toBe(true);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
  });

  it('一格太挤时这一格整体截短，而不是先来的占满、后来的叠在一起', () => {
    const placed = packBandLabels(
      Array.from({ length: 6 }, (_, i) => req(`t${i}`)),
      band,
    );
    expect(placed).toHaveLength(6);
    expect(placed.every((p) => !p.overlapping)).toBe(true);
    expect(placed.every((p) => p.widthIndex === 1)).toBe(true);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
  });

  it('实在放不下时仍然显示（最窄宽度叠放在期望位置），不会丢任务', () => {
    const placed = packBandLabels(
      Array.from({ length: 60 }, (_, i) => req(`t${i}`)),
      band,
    );
    expect(placed).toHaveLength(60);
    expect(placed.some((p) => p.overlapping)).toBe(true);
    for (const p of placed) expect(inside(p, 200, 300)).toBe(true);
  });

  it('优先级高（更紧急）的先占期望位置', () => {
    const placed = packBandLabels(
      [req('low', { priority: 1 }), req('high', { priority: 9 })],
      band,
    );
    // 期望位置 50 离 40、60 两条泳道一样近，先放的 high 占第一条
    expect(placed.find((p) => p.item === 'high')!.y).toBe(40);
    expect(placed.find((p) => p.item === 'low')!.y).toBe(60);
  });
});

describe('packBandLabels：逾期标签右端固定，向左伸展', () => {
  const end = (item: string, extra: Partial<LabelRequest<string>> = {}) =>
    req(item, {
      fixedRight: 500,
      minX: 0,
      maxX: 500,
      widths: [120, 50, 12],
      priority: 14,
      ...extra,
    });

  it('标签右端 = fixedRight', () => {
    const [late] = packBandLabels([end('late')], band);
    expect(late).toMatchObject({ x: 440, width: 120, widthIndex: 0 });
  });

  it('与其他任务的标签互相避让', () => {
    const oneLane: BandSpec = { ...band, height: 30 };
    // 普通任务的格子 [390, 470]，与逾期标签 [380, 500] 冲突，只有一条泳道
    const placed = packBandLabels(
      [end('late'), req('today', { minX: 390, maxX: 470, desiredX: 430, priority: 13 })],
      oneLane,
    );
    const late = placed.find((p) => p.item === 'late')!;
    const today = placed.find((p) => p.item === 'today')!;
    expect(late.widthIndex).toBe(0);
    expect(inside(today, 390, 470)).toBe(true);
    // 逾期标签先放；普通任务改用更短的宽度避开，或实在不行才叠放
    if (!today.overlapping) expect(overlaps(late, today)).toBe(false);
  });

  it('左侧空间不足完整宽度时改用更短的宽度', () => {
    const [late] = packBandLabels([end('late', { minX: 420 })], band);
    expect(late!.width).toBe(50);
  });
});
