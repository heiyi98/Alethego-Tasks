import { describe, expect, it } from 'vitest';

import { laneCenters, packBandLabels, type BandSpec, type LabelRequest } from './label-packing';

const band: BandSpec = {
  top: 0,
  height: 100,
  left: 0,
  right: 1000,
  laneHeight: 20,
  padding: 5,
  gap: 4,
  overflowWidth: 30,
};

const req = (item: string, anchorX: number, extra: Partial<LabelRequest<string>> = {}) => ({
  item,
  anchorX,
  desiredY: 50,
  width: 120,
  minWidth: 50,
  priority: 0,
  group: `g${anchorX}`,
  ...extra,
});

function overlaps(a: { x: number; y: number; width: number }, b: typeof a) {
  return a.y === b.y && Math.abs(a.x - b.x) < (a.width + b.width) / 2;
}

describe('laneCenters', () => {
  it('横带内等分泳道并居中', () => {
    expect(laneCenters(band)).toEqual([20, 40, 60, 80]); // (100 - 2×5) / 20 = 4 条
  });
});

describe('packBandLabels', () => {
  it('互不冲突时各自放在期望位置最近的泳道，居中于锚点', () => {
    const { placed, overflow } = packBandLabels(
      [req('a', 100, { desiredY: 12 }), req('b', 600, { desiredY: 88 })],
      band,
    );
    // 同优先级时靠右（更紧急）的先放，因此输出顺序是 b、a
    expect(placed).toEqual([
      { item: 'b', x: 600, y: 80, width: 120, anchorX: 600, displaced: false },
      { item: 'a', x: 100, y: 20, width: 120, anchorX: 100, displaced: false },
    ]);
    expect(overflow).toEqual([]);
  });

  it('同一位置的多个标签分到不同泳道，互不重叠', () => {
    const { placed } = packBandLabels(
      Array.from({ length: 5 }, (_, i) => req(`t${i}`, 300)),
      band,
    );
    // 4 条泳道各放一个覆盖锚点的标签，第 5 个移到锚点旁边（画引线）
    expect(placed).toHaveLength(5);
    expect(placed.filter((p) => p.displaced)).toHaveLength(1);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
  });

  it('优先级高（更紧急）的先占期望位置', () => {
    const { placed } = packBandLabels(
      [req('low', 300, { priority: 1 }), req('high', 300, { priority: 9 })],
      band,
    );
    // 期望位置 50 离 40、60 两条泳道一样近，先放的 high 占第一条
    expect(placed.find((p) => p.item === 'high')!.y).toBe(40);
    expect(placed.find((p) => p.item === 'low')!.y).toBe(60);
  });

  it('锚点附近被占时，标签移到锚点旁边并标记 displaced', () => {
    const oneLane: BandSpec = { ...band, height: 30 };
    const { placed } = packBandLabels(
      [req('first', 500, { priority: 2 }), req('second', 500, { priority: 1 })],
      oneLane,
    );
    expect(placed).toHaveLength(2);
    const [first, second] = [placed[0]!, placed[1]!];
    expect(first).toMatchObject({ item: 'first', x: 500, displaced: false });
    expect(second).toMatchObject({ item: 'second', anchorX: 500, displaced: true });
    expect(overlaps(first, second)).toBe(false);
  });

  it('放不下完整宽度时缩短，仍放不下的合并为 +N', () => {
    const narrow: BandSpec = { ...band, height: 30, right: 200 }; // 只有 1 条泳道，横向也很窄
    const { placed, overflow } = packBandLabels(
      [
        req('a', 60, { priority: 3 }),
        req('b', 150, { priority: 2 }),
        req('c', 150, { priority: 1 }),
      ],
      narrow,
    );
    expect(placed.map((p) => [p.item, p.width])).toEqual([
      ['a', 120],
      ['b', 50],
    ]);
    expect(overflow).toEqual([expect.objectContaining({ group: 'g150', items: ['c'], width: 30 })]);
  });

  it('靠近边界的标签向内平移，不超出范围', () => {
    const { placed } = packBandLabels([req('edge', 990)], band);
    expect(placed[0]!.x + placed[0]!.width / 2).toBeLessThanOrEqual(1000);
  });
});

describe('packBandLabels：逾期标签在点位左侧', () => {
  const end = (item: string, extra: Partial<LabelRequest<string>> = {}) =>
    req(item, 980, { align: 'end', endOffset: 10, priority: 14, group: 'overdue', ...extra });

  it('标签右端贴在点位左侧，向左伸展，不标记 displaced', () => {
    const { placed } = packBandLabels([end('late')], band);
    expect(placed).toEqual([
      { item: 'late', x: 980 - 10 - 60, y: 40, width: 120, anchorX: 980, displaced: false },
    ]);
  });

  it('向左伸展的标签与其他任务的标签互相避让（包括点位本身）', () => {
    const oneLane: BandSpec = { ...band, height: 30 };
    // 另一个任务锚在 900，标签 [840, 960] 与逾期标签 [850, 970] 重叠，只有一条泳道 → 放不下
    const { placed, overflow } = packBandLabels(
      [end('late'), req('today', 900, { priority: 13 })],
      oneLane,
    );
    const late = placed.find((p) => p.item === 'late')!;
    const today = placed.find((p) => p.item === 'today');
    if (today) {
      expect(Math.abs(today.x - late.x) >= (today.width + late.width) / 2).toBe(true);
    } else {
      expect(overflow.flatMap((o) => o.items)).toContain('today');
    }
  });

  it('多个逾期任务分到不同泳道；放不下时缩短，再放不下归入"+N"', () => {
    const { placed, overflow } = packBandLabels(
      Array.from({ length: 6 }, (_, i) => end(`late${i}`)),
      band,
    );
    expect(placed).toHaveLength(4);
    expect(new Set(placed.map((p) => p.y)).size).toBe(4);
    expect(placed.every((p) => p.x + p.width / 2 === 970)).toBe(true);
    expect(overflow).toEqual([
      expect.objectContaining({ group: 'overdue', items: ['late4', 'late5'] }),
    ]);
  });

  it('左侧空间不足完整宽度时改用最小宽度', () => {
    const narrow: BandSpec = { ...band, left: 900 };
    const { placed } = packBandLabels([end('late', { width: 120, minWidth: 50 })], narrow);
    expect(placed[0]!.width).toBe(50);
  });
});
