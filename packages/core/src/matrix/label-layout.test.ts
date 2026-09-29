import { describe, expect, it } from 'vitest';

import {
  layoutLabels,
  rectsOverlap,
  segmentHitsRect,
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

describe('layoutLabels：力导向排布', () => {
  const options: LabelOptions = {
    bounds: { left: 0, right: 1000, top: 0, bottom: 600 },
    height: 16,
    gap: 4,
    padding: 2,
  };
  const req = (id: string, x: number, y: number, width = 60): LabelRequest => ({
    id,
    x,
    y,
    r: 5,
    width,
  });
  const rect = (l: PlacedLabel): Rect => ({
    left: l.left,
    right: l.left + l.width,
    top: l.top,
    bottom: l.top + l.height,
  });
  const circleHitsRect = (d: { x: number; y: number; r: number }, r: Rect) => {
    const px = Math.min(Math.max(d.x, r.left), r.right);
    const py = Math.min(Math.max(d.y, r.top), r.bottom);
    return Math.hypot(d.x - px, d.y - py) < d.r - 1e-6;
  };

  /** 同一格挤 n 个：先错开圆点 */
  function crowd(n: number, region: Rect = { left: 400, right: 540, top: 250, bottom: 330 }) {
    const spread = separateDots(
      Array.from({ length: n }, (_, i) => ({
        id: `t${i}`,
        x: region.left + ((i * 37) % (region.right - region.left)),
        y: region.top + ((i * 53) % (region.bottom - region.top)),
        r: 5,
        region,
      })),
      3,
    );
    return [...spread].map(([id, p], i) => req(id, p.x, p.y, 40 + ((i * 17) % 40)));
  }

  function expectClean(reqs: LabelRequest[], labels: PlacedLabel[]) {
    expect(labels.map((l) => l.id)).toEqual(reqs.map((r) => r.id));
    for (let i = 0; i < labels.length; i++) {
      const own = reqs[i]!;
      // 连线一端在自己的圆点边缘
      const { leader } = labels[i]!;
      expect(Math.hypot(leader.x1 - own.x, leader.y1 - own.y)).toBeCloseTo(5, 5);
      for (let j = 0; j < labels.length; j++) {
        if (i === j) continue;
        // 标签不压任何圆点
        expect(circleHitsRect(reqs[j]!, rect(labels[i]!)), `${i} 压到圆点 ${j}`).toBe(false);
        if (j > i) {
          expect(segmentsCross(labels[i]!.leader, labels[j]!.leader), `连线 ${i}/${j}`).toBe(false);
          expect(rectsOverlap(rect(labels[i]!), rect(labels[j]!)), `标签 ${i}/${j}`).toBe(false);
        }
        // 连线不穿过别的标签
        expect(segmentHitsRect(labels[i]!.leader, rect(labels[j]!)), `连线 ${i} 穿过 ${j}`).toBe(
          false,
        );
      }
      expect(circleHitsRect(own, rect(labels[i]!))).toBe(false);
    }
  }

  it('孤立的任务：标签紧挨着圆点，一条短线连回去', () => {
    const reqs = [req('a', 300, 300)];
    const [label] = layoutLabels(reqs, options);
    const { leader } = label!;
    expect(Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1)).toBeLessThan(12);
    expectClean(reqs, [label!]);
  });

  it('同一格挤 10 个：互不重叠、连线不交叉也不穿过别的标签，标签不压圆点，每个任务都在', () => {
    const reqs = crowd(10);
    expectClean(reqs, layoutLabels(reqs, options));
  });

  it('不预先规定方向：挤在一起时标签分布在圆点的不同方向', () => {
    const reqs = crowd(10);
    const labels = layoutLabels(reqs, options);
    const sides = new Set(
      labels.map((l, i) => {
        const cx = l.left + l.width / 2;
        const cy = l.top + l.height / 2;
        const dx = cx - reqs[i]!.x;
        const dy = cy - reqs[i]!.y;
        return Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? 'right'
            : 'left'
          : dy > 0
            ? 'below'
            : 'above';
      }),
    );
    expect(sides.size).toBeGreaterThanOrEqual(2);
  });

  it('靠近边界时标签留在范围内', () => {
    const reqs = [req('a', 995, 300), req('b', 5, 5)];
    for (const label of layoutLabels(reqs, options)) {
      expect(label.left).toBeGreaterThanOrEqual(0);
      expect(label.left + label.width).toBeLessThanOrEqual(1000);
      expect(label.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('结果只取决于输入：同样的数据每次一样，与输入顺序无关', () => {
    const reqs = crowd(8);
    const a = layoutLabels(reqs, options);
    const b = layoutLabels([...reqs].reverse(), options);
    expect(layoutLabels(reqs, options)).toEqual(a);
    expect(new Map(b.map((l) => [l.id, l]))).toEqual(new Map(a.map((l) => [l.id, l])));
  });

  it('实在太挤时（一格 30 个）仍返回全部任务：允许标签轻微重叠，但连线不交叉、标签不压圆点', () => {
    const reqs = crowd(30, { left: 400, right: 550, top: 240, bottom: 330 });
    const labels = layoutLabels(reqs, options);
    expect(labels).toHaveLength(30);
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        if (j > i) expect(segmentsCross(labels[i]!.leader, labels[j]!.leader)).toBe(false);
        expect(circleHitsRect(reqs[j]!, rect(labels[i]!))).toBe(false);
      }
    }
  });
});
