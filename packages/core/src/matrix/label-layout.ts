/**
 * 矩阵图上的圆点与标签排布（纯几何，Web / Mobile 共用；单位由调用方决定，通常是 SVG 坐标）。
 *
 * 圆点才是任务的位置：
 * - separateDots：每个圆点先放在按 id 固定的位置，再在各自的区域（所属格子内部）里错开，直到互不重叠
 *
 * 标签 = 写在一条细横线上的标题，横线的一端是圆点：
 * - layoutLabels：孤立的圆点，横线从文字直接通到圆点；
 *   靠在一起的圆点保持真实位置，标签在旁边（左或右，选有空位的一侧）排成一列、上下错开，
 *   每个标签的横线走到头后拐一小段斜线连到自己的圆点，同一列里的连线互不交叉。
 *   实在排不下时允许标签之间轻微重叠，不隐藏任何任务。
 */

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/* ---------------- 圆点错开 ---------------- */

export interface DotRequest {
  id: string;
  /** 期望位置（按 id 固定的偏移换算而来） */
  x: number;
  y: number;
  r: number;
  /** 圆点中心允许的范围（所属格子的内部）；宽或高可以为 0（例如贴着左边缘的一列） */
  region: Rect;
}

const MAX_RELAX_ROUNDS = 400;

function clampTo(region: Rect, p: Point): Point {
  return {
    x: Math.min(Math.max(p.x, region.left), region.right),
    y: Math.min(Math.max(p.y, region.top), region.bottom),
  };
}

function anyOverlap(dots: readonly DotRequest[], pos: readonly Point[], gap: number): boolean {
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const need = dots[i]!.r + dots[j]!.r + gap;
      if (Math.hypot(pos[i]!.x - pos[j]!.x, pos[i]!.y - pos[j]!.y) < need - 1e-6) return true;
    }
  }
  return false;
}

const regionKey = (r: Rect) => `${r.left}:${r.right}:${r.top}:${r.bottom}`;

/**
 * 同一区域里放不下时的兜底：按期望位置的先后排成网格（区域宽度不够时向右延伸）。
 */
function gridInRegion(dots: readonly DotRequest[], gap: number): Point[] {
  const region = dots[0]!.region;
  const step = Math.max(...dots.map((d) => d.r)) * 2 + gap;
  const rows = Math.max(1, Math.floor((region.bottom - region.top) / step) + 1);
  const cols = Math.ceil(dots.length / rows);
  const order = dots
    .map((d, i) => i)
    .sort((a, b) => dots[a]!.y - dots[b]!.y || dots[a]!.x - dots[b]!.x);
  const usedRows = Math.ceil(dots.length / cols);
  const height = (usedRows - 1) * step;
  const top = region.top + Math.max(0, (region.bottom - region.top - height) / 2);
  const width = (cols - 1) * step;
  const left = region.left + Math.max(0, (region.right - region.left - width) / 2);
  const result: Point[] = new Array(dots.length);
  order.forEach((index, k) => {
    result[index] = { x: left + (k % cols) * step, y: top + Math.floor(k / cols) * step };
  });
  return result;
}

/** 让圆点互不重叠（圆点之间至少留 gap），每个圆点不离开自己的区域；结果只取决于输入，不随机 */
export function separateDots(dots: readonly DotRequest[], gap: number): Map<string, Point> {
  const order = [...dots].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let pos = order.map((d) => clampTo(d.region, d));

  for (let round = 0; round < MAX_RELAX_ROUNDS; round++) {
    let moved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = order[i]!;
        const b = order[j]!;
        const need = a.r + b.r + gap;
        let dx = pos[j]!.x - pos[i]!.x;
        let dy = pos[j]!.y - pos[i]!.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= need - 1e-6) continue;
        if (dist < 1e-6) {
          // 完全重合：按序号给一个固定方向
          const angle = (i * 7 + j * 13) * 2.399963;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
        } else {
          dx /= dist;
          dy /= dist;
        }
        const push = (need - dist) / 2 + 0.01;
        const pi = clampTo(a.region, { x: pos[i]!.x - dx * push, y: pos[i]!.y - dy * push });
        const pj = clampTo(b.region, { x: pos[j]!.x + dx * push, y: pos[j]!.y + dy * push });
        pos[i] = pi;
        pos[j] = pj;
        moved = true;
      }
    }
    if (!moved) break;
  }

  if (anyOverlap(order, pos, gap)) {
    // 兜底：仍有重叠的区域整体排成网格
    const byRegion = new Map<string, number[]>();
    order.forEach((d, i) => {
      const key = regionKey(d.region);
      byRegion.set(key, [...(byRegion.get(key) ?? []), i]);
    });
    pos = [...pos];
    for (const indexes of byRegion.values()) {
      const members = indexes.map((i) => order[i]!);
      const local = indexes.map((i) => pos[i]!);
      if (members.length > 1 && anyOverlap(members, local, gap)) {
        const grid = gridInRegion(members, gap);
        indexes.forEach((i, k) => (pos[i] = grid[k]!));
      }
    }
  }

  return new Map(order.map((d, i) => [d.id, pos[i]!]));
}

/* ---------------- 标签 ---------------- */

export type LabelSide = 'left' | 'right';

export interface LabelRequest {
  id: string;
  /** 圆点（已错开后的真实位置） */
  x: number;
  y: number;
  r: number;
  /** 标签（标题文字）宽度 */
  width: number;
  /** 聚集判断只在同一组（通常是同一格）里进行 */
  group: string;
  /** 允许的一侧，按偏好排序：靠近左边缘的只向右，靠近右边缘和逾期区的只向左 */
  sides: readonly LabelSide[];
}

export interface LabelOptions {
  /** 标签可以占用的范围 */
  bounds: Rect;
  /** 横线以上的高度（文字） */
  ascent: number;
  /** 横线以下的高度 */
  descent: number;
  /** 一列标签里相邻两条横线的间距 */
  slot: number;
  /** 圆点边缘到文字的距离 */
  dotGap: number;
  /** 一列标签离最外侧圆点的距离 */
  columnGap: number;
}

export interface PlacedLabel {
  id: string;
  side: LabelSide;
  /** 横线的 y */
  lineY: number;
  /** 横线的两端（x1 < x2） */
  lineX1: number;
  lineX2: number;
  /** 文字左端的 x */
  textX: number;
  /** 从横线尽头连到圆点边缘的一小段；孤立的标签为 null（横线直接通到圆点） */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

function intersectArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

function dotRect(d: { x: number; y: number; r: number }): Rect {
  return { left: d.x - d.r, right: d.x + d.r, top: d.y - d.r, bottom: d.y + d.r };
}

function outsideArea(box: Rect, bounds: Rect): number {
  const area = (box.right - box.left) * (box.bottom - box.top);
  return area - intersectArea(box, bounds);
}

/** 两条线段是否相交（含端点以外的真正交叉） */
export function segmentsCross(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = cross(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = cross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = cross(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

interface Candidate {
  labels: PlacedLabel[];
  boxes: Rect[];
}

function labelBox(label: PlacedLabel, width: number, options: LabelOptions): Rect {
  const left = label.side === 'right' ? label.textX : label.textX;
  return {
    left,
    right: left + width,
    top: label.lineY - options.ascent,
    bottom: label.lineY + options.descent,
  };
}

/** 孤立的标签：横线从文字直接通到圆点 */
function isolated(req: LabelRequest, side: LabelSide, options: LabelOptions): Candidate {
  const textX =
    side === 'right' ? req.x + req.r + options.dotGap : req.x - req.r - options.dotGap - req.width;
  const label: PlacedLabel = {
    id: req.id,
    side,
    lineY: req.y,
    lineX1: side === 'right' ? req.x : textX,
    lineX2: side === 'right' ? textX + req.width : req.x,
    textX,
    leader: null,
  };
  return { labels: [label], boxes: [labelBox(label, req.width, options)] };
}

/** 一列标签：按圆点的上下顺序排开，横线走到头拐一小段斜线连到圆点，并消除交叉 */
function column(
  members: readonly LabelRequest[],
  side: LabelSide,
  options: LabelOptions,
  /** 整列上下挪动几个位置（挪开别人的标签） */
  shift = 0,
): Candidate {
  const { bounds, slot } = options;
  const x0 =
    side === 'right'
      ? Math.max(...members.map((m) => m.x + m.r)) + options.columnGap
      : Math.min(...members.map((m) => m.x - m.r)) - options.columnGap;
  const sorted = [...members].sort((a, b) => a.y - b.y || a.x - b.x);
  const n = sorted.length;
  const centerY = sorted.reduce((sum, m) => sum + m.y, 0) / n;
  let firstY = centerY - ((n - 1) * slot) / 2 + shift * slot;
  const minFirst = bounds.top + options.ascent;
  const maxFirst = bounds.bottom - options.descent - (n - 1) * slot;
  firstY = Math.max(Math.min(firstY, maxFirst), minFirst);
  const slots = sorted.map((_, i) => firstY + i * slot);

  // assignment[k] = 第 k 个位置上的圆点
  const assignment = [...sorted];
  const leaderOf = (k: number) => {
    const m = assignment[k]!;
    const y = slots[k]!;
    const dx = m.x - x0;
    const dy = m.y - y;
    const len = Math.hypot(dx, dy) || 1;
    return { x1: x0, y1: y, x2: m.x - (dx / len) * m.r, y2: m.y - (dy / len) * m.r };
  };
  // 交换一对交叉连线的终点，总长度严格变短，因此一定会结束
  for (let round = 0; round < n * n + 10; round++) {
    let swapped = false;
    for (let i = 0; i < n && !swapped; i++) {
      for (let j = i + 1; j < n; j++) {
        if (segmentsCross(leaderOf(i), leaderOf(j))) {
          [assignment[i], assignment[j]] = [assignment[j]!, assignment[i]!];
          swapped = true;
          break;
        }
      }
    }
    if (!swapped) break;
  }

  const labels = assignment.map((m, k): PlacedLabel => {
    const lineY = slots[k]!;
    const textX = side === 'right' ? x0 : x0 - m.width;
    return {
      id: m.id,
      side,
      lineY,
      lineX1: textX,
      lineX2: textX + m.width,
      textX,
      leader: leaderOf(k),
    };
  });
  return {
    labels,
    boxes: labels.map((label, k) => labelBox(label, assignment[k]!.width, options)),
  };
}

type Segment = { x1: number; y1: number; x2: number; y2: number };

/** 线段穿过矩形的长度（取样估算） */
function segmentInRect(seg: Segment, rect: Rect): number {
  const steps = 16;
  const length = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  let inside = 0;
  for (let i = 0; i <= steps; i++) {
    const x = seg.x1 + ((seg.x2 - seg.x1) * i) / steps;
    const y = seg.y1 + ((seg.y2 - seg.y1) * i) / steps;
    if (x > rect.left && x < rect.right && y > rect.top && y < rect.bottom) inside++;
  }
  return (inside / (steps + 1)) * length;
}

interface Placed {
  boxes: Rect[];
  leaders: Segment[];
}

/** 分数越低越清楚：不出界、不压别人的标签和圆点、连线不交叉、不穿过标签，连线越短越好 */
function scoreOf(
  candidate: Candidate,
  placed: Placed,
  dots: readonly LabelRequest[],
  ownIds: ReadonlySet<string>,
  options: LabelOptions,
): number {
  let score = 0;
  for (const box of candidate.boxes) {
    score += outsideArea(box, options.bounds) * 20;
    for (const other of placed.boxes) score += intersectArea(box, other);
    for (const dot of dots) {
      if (!ownIds.has(dot.id)) score += intersectArea(box, dotRect(dot)) * 10;
    }
    for (const leader of placed.leaders) score += segmentInRect(leader, box) * 20;
  }
  for (const label of candidate.labels) {
    const { leader } = label;
    if (!leader) continue;
    score += Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) * 0.5;
    for (const other of placed.leaders) if (segmentsCross(leader, other)) score += 400;
    for (const box of placed.boxes) score += segmentInRect(leader, box) * 20;
  }
  return score;
}

/** 标签整列上下挪动的候选位置数 */
const SHIFTS = [0, -1, 1, -2, 2, -3, 3, -4, 4];

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

/** 首选一侧：允许的一侧里第一个放得进范围的 */
function preferredSide(req: LabelRequest, options: LabelOptions): LabelSide {
  for (const side of req.sides) {
    if (outsideArea(isolated(req, side, options).boxes[0]!, options.bounds) === 0) return side;
  }
  return req.sides[0] ?? 'right';
}

export function layoutLabels(
  requests: readonly LabelRequest[],
  options: LabelOptions,
): PlacedLabel[] {
  const reqs = [...requests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 1. 聚集：同一组里，按首选一侧放时标签压到别的圆点或别的标签，就算靠在一起
  const preferredBoxes = reqs.map((r) => isolated(r, preferredSide(r, options), options).boxes[0]!);
  const uf = new UnionFind(reqs.length);
  for (let i = 0; i < reqs.length; i++) {
    for (let j = i + 1; j < reqs.length; j++) {
      if (reqs[i]!.group !== reqs[j]!.group) continue;
      if (
        intersectArea(preferredBoxes[i]!, preferredBoxes[j]!) > 0 ||
        intersectArea(preferredBoxes[i]!, dotRect(reqs[j]!)) > 0 ||
        intersectArea(preferredBoxes[j]!, dotRect(reqs[i]!)) > 0
      ) {
        uf.union(i, j);
      }
    }
  }
  // 一组里只要有靠在一起的，这一组就整体排成一列（或左右各一列）：几列不会互相压，
  // 夹在中间的零散任务也不会被别人的标签盖住
  const sizes = new Map<number, number>();
  reqs.forEach((_, i) => sizes.set(uf.find(i), (sizes.get(uf.find(i)) ?? 0) + 1));
  const crowdedGroups = new Set(
    reqs.filter((_, i) => sizes.get(uf.find(i))! >= 2).map((r) => r.group),
  );
  const firstOfGroup = new Map<string, number>();
  reqs.forEach((r, i) => {
    if (!crowdedGroups.has(r.group)) return;
    const first = firstOfGroup.get(r.group);
    if (first === undefined) firstOfGroup.set(r.group, i);
    else uf.union(i, first);
  });
  const clusters = new Map<number, LabelRequest[]>();
  reqs.forEach((r, i) => {
    const root = uf.find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), r]);
  });
  // 大的一簇先放，孤立的最后放
  const ordered = [...clusters.values()].sort(
    (a, b) => b.length - a.length || (a[0]!.id < b[0]!.id ? -1 : 1),
  );

  const placed: Placed = { boxes: [], leaders: [] };
  const result: PlacedLabel[] = [];
  for (const members of ordered) {
    const ownIds = new Set(members.map((m) => m.id));
    const sides = members[0]!.sides.filter((side) => members.every((m) => m.sides.includes(side)));
    const allowed: readonly LabelSide[] = sides.length > 0 ? sides : members[0]!.sides;

    const candidates: { candidate: Candidate; bias: number }[] = [];
    if (members.length === 1) {
      const req = members[0]!;
      allowed.forEach((side, i) => {
        candidates.push({ candidate: isolated(req, side, options), bias: i * 40 });
        // 旁边被占了：标签上下挪开，拐一小段连回圆点
        for (const k of SHIFTS) {
          if (k === 0) continue;
          candidates.push({
            candidate: column(members, side, options, k),
            bias: 30 + i * 40 + Math.abs(k) * 8,
          });
        }
      });
    } else {
      allowed.forEach((side, i) => {
        for (const k of SHIFTS) {
          candidates.push({
            candidate: column(members, side, options, k),
            bias: i * 40 + Math.abs(k) * 8,
          });
        }
      });
      if (allowed.includes('left') && allowed.includes('right') && members.length >= 4) {
        // 左半边的向左排、右半边的向右排：两列的连线分在两侧，不会交叉
        const byX = [...members].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
        const half = Math.ceil(byX.length / 2);
        const left = column(byX.slice(0, half), 'left', options);
        const right = column(byX.slice(half), 'right', options);
        candidates.push({
          candidate: {
            labels: [...left.labels, ...right.labels],
            boxes: [...left.boxes, ...right.boxes],
          },
          bias: 20,
        });
      }
    }

    let best = candidates[0]!.candidate;
    let bestScore = Infinity;
    for (const { candidate, bias } of candidates) {
      const score = scoreOf(candidate, placed, reqs, ownIds, options) + bias;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    placed.boxes.push(...best.boxes);
    for (const label of best.labels) if (label.leader) placed.leaders.push(label.leader);
    result.push(...best.labels);
  }

  const byId = new Map(result.map((label) => [label.id, label]));
  return requests.map((r) => byId.get(r.id)!);
}
