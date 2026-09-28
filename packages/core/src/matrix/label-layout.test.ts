import { describe, expect, it } from 'vitest';

import {
  layoutLabels,
  segmentsCross,
  separateDots,
  type DotRequest,
  type LabelOptions,
  type LabelRequest,
  type PlacedLabel,
  type Rect,
} from './label-layout';

const cellRegion: Rect = { left: 110, right: 290, top: 110, bottom: 290 };

describe('separateDots：圆点在各自的区域里错开，互不重叠', () => {
  const dot = (id: string, x: number, y: number, region = cellRegion): DotRequest => ({
    id,
    x,
    y,
    r: 5,
    region,
  });

  it('本来就不挤的圆点保持原位', () => {
    const result = separateDots([dot('a', 150, 150), dot('b', 250, 250)], 3);
    expect(result.get('a')).toEqual({ x: 150, y: 150 });
    expect(result.get('b')).toEqual({ x: 250, y: 250 });
  });

  it('期望位置在区域外时收进区域', () => {
    expect(separateDots([dot('a', 0, 400)], 3).get('a')).toEqual({ x: 110, y: 290 });
  });

  it('挤在一起的圆点错开到互不重叠，且都不离开区域；结果与输入顺序无关', () => {
    const dots = Array.from({ length: 12 }, (_, i) => dot(`t${i}`, 200 + (i % 3), 200 + (i % 2)));
    const result = separateDots(dots, 3);
    const points = [...result.values()];
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(cellRegion.left);
      expect(p.x).toBeLessThanOrEqual(cellRegion.right);
      expect(p.y).toBeGreaterThanOrEqual(cellRegion.top);
      expect(p.y).toBeLessThanOrEqual(cellRegion.bottom);
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
        expect(d).toBeGreaterThanOrEqual(13 - 1e-6);
      }
    }
    expect(separateDots([...dots].reverse(), 3)).toEqual(result);
  });

  it('宽度为 0 的区域（贴左边缘的一列）只上下错开', () => {
    const edge: Rect = { left: 10, right: 10, top: 0, bottom: 100 };
    const result = separateDots([dot('a', 10, 50, edge), dot('b', 10, 50, edge)], 3);
    expect(result.get('a')!.x).toBe(10);
    expect(result.get('b')!.x).toBe(10);
    expect(Math.abs(result.get('a')!.y - result.get('b')!.y)).toBeGreaterThanOrEqual(13 - 1e-6);
  });

  it('区域太小放不下时排成网格，仍互不重叠', () => {
    const tiny: Rect = { left: 0, right: 20, top: 0, bottom: 20 };
    const dots = Array.from({ length: 9 }, (_, i) => dot(`t${i}`, 10, 10, tiny));
    const points = [...separateDots(dots, 3).values()];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
        expect(d).toBeGreaterThanOrEqual(13 - 1e-6);
      }
    }
  });
});

describe('layoutLabels', () => {
  const options: LabelOptions = {
    bounds: { left: 0, right: 1000, top: 0, bottom: 600 },
    ascent: 14,
    descent: 3,
    slot: 18,
    dotGap: 3,
    columnGap: 10,
  };
  const req = (
    id: string,
    x: number,
    y: number,
    extra: Partial<LabelRequest> = {},
  ): LabelRequest => ({
    id,
    x,
    y,
    r: 5,
    width: 60,
    group: 'cell',
    sides: ['right', 'left'],
    ...extra,
  });
  const box = (l: PlacedLabel, width = 60): Rect => ({
    left: l.textX,
    right: l.textX + width,
    top: l.lineY - options.ascent,
    bottom: l.lineY + options.descent,
  });
  const overlaps = (a: Rect, b: Rect) =>
    Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
    Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

  it('孤立的任务：横线从文字直接通到圆点，没有拐线', () => {
    const [label] = layoutLabels([req('a', 300, 300)], options);
    expect(label).toMatchObject({
      side: 'right',
      lineY: 300,
      lineX1: 300,
      textX: 308,
      leader: null,
    });
    expect(label!.lineX2).toBe(368);
  });

  it('靠近右边缘放不下时向左', () => {
    const [label] = layoutLabels([req('a', 980, 300)], options);
    expect(label).toMatchObject({ side: 'left', lineX2: 980, textX: 980 - 8 - 60, leader: null });
  });

  it('只允许向左的（逾期区）：圆点在标签右端，标题在圆点左边', () => {
    const [label] = layoutLabels([req('a', 500, 300, { sides: ['left'] })], options);
    expect(label!.side).toBe('left');
    expect(label!.lineX2).toBe(500);
    expect(label!.textX + 60).toBeLessThan(500);
  });

  it('同一格里挤 10 个：标签排成列、上下错开不重叠，连线互不交叉，每个任务都在', () => {
    const region: Rect = { left: 400, right: 500, top: 250, bottom: 330 };
    const spread = separateDots(
      Array.from({ length: 10 }, (_, i) => ({
        id: `t${i}`,
        x: 400 + ((i * 37) % 100),
        y: 250 + ((i * 53) % 80),
        r: 5,
        region,
      })),
      3,
    );
    const reqs = [...spread].map(([id, p]) => req(id, p.x, p.y));
    const labels = layoutLabels(reqs, options);
    expect(labels.map((l) => l.id)).toEqual(reqs.map((r) => r.id));
    expect(labels.every((l) => l.leader !== null)).toBe(true);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(segmentsCross(labels[i]!.leader!, labels[j]!.leader!)).toBe(false);
        expect(overlaps(box(labels[i]!), box(labels[j]!))).toBe(false);
      }
    }
    // 连线的一端在横线尽头，另一端在自己的圆点边缘
    for (const label of labels) {
      const dot = reqs.find((r) => r.id === label.id)!;
      const { leader } = label;
      expect(leader!.y1).toBe(label.lineY);
      expect([label.lineX1, label.lineX2]).toContain(leader!.x1);
      expect(Math.hypot(leader!.x2 - dot.x, leader!.y2 - dot.y)).toBeCloseTo(5, 5);
    }
  });

  it('靠近左边缘的一簇向右排', () => {
    const reqs = Array.from({ length: 5 }, (_, i) =>
      req(`t${i}`, 20 + i * 6, 300 + i * 4, { sides: ['right'] }),
    );
    expect(layoutLabels(reqs, options).every((l) => l.side === 'right')).toBe(true);
  });

  it('不同组（不同格）的圆点不算一簇', () => {
    const labels = layoutLabels(
      [req('a', 300, 300, { group: 'x' }), req('b', 330, 300, { group: 'y' })],
      options,
    );
    expect(labels.every((l) => l.leader === null)).toBe(true);
  });

  it('结果与输入顺序无关', () => {
    const reqs = Array.from({ length: 6 }, (_, i) => req(`t${i}`, 300 + i * 9, 300 + (i % 3) * 7));
    const a = layoutLabels(reqs, options);
    const b = layoutLabels([...reqs].reverse(), options);
    expect(new Map(b.map((l) => [l.id, l]))).toEqual(new Map(a.map((l) => [l.id, l])));
  });
});
