/**
 * 矩阵图上的圆点与标签排布（纯几何，Web / Mobile 共用；单位由调用方决定，通常是 SVG 坐标）。
 *
 * 圆点才是任务的位置：
 * - separateDots：每个圆点先放在按 id 固定的位置，再在各自的区域（所属格子内部）里错开，直到互不重叠
 *
 * 标签 = 写在一条细横线上的标题，用一条细线连回自己的圆点：
 * - layoutLabels：力导向排布。所有标签同时迭代：互相重叠时互相推开，压到圆点时被推开，
 *   被弹簧拉回自己的圆点附近，被连线穿过时让开；不预先规定标签在圆点的哪一侧。
 *   迭代中途交换连线交叉的两个标签的位置，直到连线互不交叉。
 *   达到迭代上限仍有重叠时允许标签间轻微重叠，不隐藏任何任务。结果只取决于输入，没有随机成分。
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

/** 线段 */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LabelRequest {
  id: string;
  /** 圆点（已错开后的真实位置） */
  x: number;
  y: number;
  r: number;
  /** 标签（标题文字）宽度 */
  width: number;
}

export interface LabelOptions {
  /** 标签可以占用的范围 */
  bounds: Rect;
  /** 标签高度（文字加横线） */
  height: number;
  /** 标签与自己圆点之间希望留的距离（弹簧的自然长度） */
  gap: number;
  /** 标签之间、标签与圆点之间至少留的空隙 */
  padding: number;
  /** 迭代上限 */
  iterations?: number;
}

export interface PlacedLabel {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** 从圆点边缘连到标签的细线 */
  leader: Segment;
}

/** 两条线段是否真正交叉（端点相接不算） */
export function segmentsCross(a: Segment, b: Segment): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = cross(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = cross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = cross(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

/** 线段是否穿过矩形内部 */
export function segmentHitsRect(seg: Segment, rect: Rect): boolean {
  // Liang–Barsky 裁剪
  let t0 = 0;
  let t1 = 1;
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const edges: [number, number][] = [
    [-dx, seg.x1 - rect.left],
    [dx, rect.right - seg.x1],
    [-dy, seg.y1 - rect.top],
    [dy, rect.bottom - seg.y1],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-6;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1e-6 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1e-6
  );
}

interface Body {
  req: LabelRequest;
  /** 标签中心 */
  cx: number;
  cy: number;
}

const rectOf = (b: Body, height: number): Rect => ({
  left: b.cx - b.req.width / 2,
  right: b.cx + b.req.width / 2,
  top: b.cy - height / 2,
  bottom: b.cy + height / 2,
});

/**
 * 连线：从圆点边缘连到标签。标签在圆点下方或旁边时连到横线（标签底边）上离圆点最近的一点，
 * 在圆点正下方时连到标签顶边，都不穿过文字。
 */
function leaderOf(b: Body, height: number): Segment {
  const rect = rectOf(b, height);
  const { x, y, r } = b.req;
  let ex: number;
  let ey: number;
  if (y >= rect.bottom || x < rect.left || x > rect.right) {
    // 圆点在标签下方或两侧：连到横线上最近的一点
    ex = Math.min(Math.max(x, rect.left), rect.right);
    ey = rect.bottom;
  } else {
    // 圆点在标签正上方：连到顶边
    ex = x;
    ey = rect.top;
  }
  const dx = ex - x;
  const dy = ey - y;
  const len = Math.hypot(dx, dy) || 1;
  return { x1: x + (dx / len) * r, y1: y + (dy / len) * r, x2: ex, y2: ey };
}

function clampInto(b: Body, bounds: Rect, height: number) {
  const hw = b.req.width / 2;
  const hh = height / 2;
  b.cx = Math.min(Math.max(b.cx, bounds.left + hw), Math.max(bounds.left + hw, bounds.right - hw));
  b.cy = Math.min(Math.max(b.cy, bounds.top + hh), Math.max(bounds.top + hh, bounds.bottom - hh));
}

/** 初始位置：离附近其他圆点的方向，放在圆点旁边（没有邻居时放右边） */
function initialBody(req: LabelRequest, all: readonly LabelRequest[], options: LabelOptions): Body {
  let vx = 0;
  let vy = 0;
  for (const other of all) {
    if (other === req) continue;
    const dx = req.x - other.x;
    const dy = req.y - other.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < 120) {
      vx += (dx / d) * (120 - d);
      vy += (dy / d) * (120 - d);
    }
  }
  const len = Math.hypot(vx, vy);
  let dirX = len > 1e-6 ? vx / len : 1;
  let dirY = len > 1e-6 ? vy / len : 0;
  // 偏向左右两侧：标签是横长的，放在两侧更不容易互相压
  if (Math.abs(dirX) < 0.35) dirX = dirX < 0 ? -0.35 : 0.35;
  const n = Math.hypot(dirX, dirY);
  dirX /= n;
  dirY /= n;
  const reach = req.r + options.gap;
  return {
    req,
    cx: req.x + dirX * (reach + req.width / 2),
    cy: req.y + dirY * (reach + options.height / 2),
  };
}

/** 交换连线交叉的两个标签的位置；轮数有上限 */
function uncross(bodies: Body[], height: number): boolean {
  let changed = false;
  const maxRounds = bodies.length * bodies.length + 10;
  for (let round = 0; round < maxRounds; round++) {
    let swapped = false;
    const leaders = bodies.map((b) => leaderOf(b, height));
    for (let i = 0; i < bodies.length && !swapped; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (!segmentsCross(leaders[i]!, leaders[j]!)) continue;
        const a = bodies[i]!;
        const b = bodies[j]!;
        const lengthOf = (seg: Segment) => Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
        // 这两条连线与所有连线的交叉数
        const crossingsOf = (la: Segment, lb: Segment) => {
          let count = segmentsCross(la, lb) ? 1 : 0;
          leaders.forEach((other, k) => {
            if (k === i || k === j) return;
            if (segmentsCross(la, other)) count++;
            if (segmentsCross(lb, other)) count++;
          });
          return count;
        };
        const beforeCross = crossingsOf(leaders[i]!, leaders[j]!);
        const beforeLength = lengthOf(leaders[i]!) + lengthOf(leaders[j]!);
        [a.cx, b.cx] = [b.cx, a.cx];
        [a.cy, b.cy] = [b.cy, a.cy];
        const la = leaderOf(a, height);
        const lb = leaderOf(b, height);
        const afterCross = crossingsOf(la, lb);
        // 只接受让交叉变少、或交叉不变但连线总长变短的交换：按（交叉数，总长）严格变小，所以一定会结束
        const better =
          afterCross < beforeCross ||
          (afterCross === beforeCross && lengthOf(la) + lengthOf(lb) < beforeLength - 1e-9);
        if (!better) {
          [a.cx, b.cx] = [b.cx, a.cx];
          [a.cy, b.cy] = [b.cy, a.cy];
          continue;
        }
        swapped = true;
        changed = true;
        break;
      }
    }
    if (!swapped) break;
  }
  return changed;
}

/** 把压在圆点上的标签沿最近的方向挪开（移动最小），保证圆点完全可见 */
function clearDots(bodies: Body[], options: LabelOptions): boolean {
  const { height, padding, bounds } = options;
  let moved = false;
  for (let pass = 0; pass < 20; pass++) {
    let any = false;
    for (const body of bodies) {
      for (const other of bodies) {
        const rect = rectOf(body, height);
        const { x, y, r } = other.req;
        const need = r + padding;
        const px = Math.min(Math.max(x, rect.left), rect.right);
        const py = Math.min(Math.max(y, rect.top), rect.bottom);
        if (Math.hypot(x - px, y - py) >= need - 1e-6) continue;
        // 四个方向各需要挪多远，取最小的
        const moves: [number, number][] = [
          [x + need - rect.left, 0],
          [x - need - rect.right, 0],
          [0, y + need - rect.top],
          [0, y - need - rect.bottom],
        ];
        moves.sort((m1, m2) => Math.abs(m1[0] + m1[1]) - Math.abs(m2[0] + m2[1]));
        const before = { cx: body.cx, cy: body.cy };
        for (const [mx, my] of moves) {
          body.cx = before.cx + mx + Math.sign(mx) * 0.01;
          body.cy = before.cy + my + Math.sign(my) * 0.01;
          clampInto(body, bounds, height);
          const moved2 = rectOf(body, height);
          const qx = Math.min(Math.max(x, moved2.left), moved2.right);
          const qy = Math.min(Math.max(y, moved2.top), moved2.bottom);
          if (Math.hypot(x - qx, y - qy) >= need - 1e-6) break;
        }
        any = true;
        moved = true;
      }
    }
    if (!any) break;
  }
  return moved;
}

/** 某个标签当前位置的代价：与别人冲突得越多越高，连线越长越高 */
function costOf(i: number, bodies: readonly Body[], options: LabelOptions): number {
  const { height, bounds } = options;
  const body = bodies[i]!;
  const rect = rectOf(body, height);
  const leader = leaderOf(body, height);
  let cost = Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) * 0.5;
  if (
    rect.left < bounds.left ||
    rect.right > bounds.right ||
    rect.top < bounds.top ||
    rect.bottom > bounds.bottom
  ) {
    cost += 1e6;
  }
  for (let j = 0; j < bodies.length; j++) {
    const other = bodies[j]!;
    const { x, y, r } = other.req;
    const px = Math.min(Math.max(x, rect.left), rect.right);
    const py = Math.min(Math.max(y, rect.top), rect.bottom);
    if (Math.hypot(x - px, y - py) < r + options.padding) cost += 5000;
    if (j === i) continue;
    const otherRect = rectOf(other, height);
    const ox =
      Math.min(rect.right, otherRect.right) - Math.max(rect.left, otherRect.left) + options.padding;
    const oy =
      Math.min(rect.bottom, otherRect.bottom) - Math.max(rect.top, otherRect.top) + options.padding;
    if (ox > 0 && oy > 0) cost += 300 + ox * oy * 5;
    const otherLeader = leaderOf(other, height);
    if (segmentsCross(leader, otherLeader)) cost += 20000;
    if (segmentHitsRect(leader, otherRect)) cost += 2000;
    if (segmentHitsRect(otherLeader, rect)) cost += 2000;
  }
  return cost;
}

/**
 * 修补：力导向迭代后仍有冲突的标签，在自己圆点周围的一圈圈候选位置里挑代价最低的（不随机，按固定顺序）。
 */
function repair(bodies: Body[], options: LabelOptions) {
  const { height, gap } = options;
  const angles = Array.from({ length: 24 }, (_, k) => (k * Math.PI * 2) / 24);
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!;
      const current = costOf(i, bodies, options);
      if (current < 300) continue;
      const start = { cx: body.cx, cy: body.cy };
      let best = { cx: body.cx, cy: body.cy, cost: current };
      for (const reach of [0, 14, 28, 44, 62, 84, 110]) {
        for (const angle of angles) {
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          body.cx = body.req.x + dx * (body.req.r + gap + reach + body.req.width / 2);
          body.cy = body.req.y + dy * (body.req.r + gap + reach + height / 2);
          clampInto(body, options.bounds, height);
          const cost = costOf(i, bodies, options);
          if (cost < best.cost - 1e-6) best = { cx: body.cx, cy: body.cy, cost };
        }
      }
      body.cx = best.cx;
      body.cy = best.cy;
      if (best.cx !== start.cx || best.cy !== start.cy) improved = true;
    }
    if (!improved) break;
  }
}

/** 标签互相重叠，或某条连线穿过别的标签 */
function hasLabelConflict(bodies: readonly Body[], height: number): boolean {
  const rects = bodies.map((b) => rectOf(b, height));
  const leaders = bodies.map((b) => leaderOf(b, height));
  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      if (j > i && rectsOverlap(rects[i]!, rects[j]!)) return true;
      if (segmentHitsRect(leaders[i]!, rects[j]!)) return true;
    }
  }
  return false;
}

function hasDotOverlap(bodies: readonly Body[], options: LabelOptions): boolean {
  for (const body of bodies) {
    const rect = rectOf(body, options.height);
    for (const other of bodies) {
      const { x, y, r } = other.req;
      const px = Math.min(Math.max(x, rect.left), rect.right);
      const py = Math.min(Math.max(y, rect.top), rect.bottom);
      if (Math.hypot(x - px, y - py) < r - 1e-6) return true;
    }
  }
  return false;
}

function hasCrossing(bodies: readonly Body[], height: number): boolean {
  const leaders = bodies.map((b) => leaderOf(b, height));
  for (let i = 0; i < leaders.length; i++) {
    for (let j = i + 1; j < leaders.length; j++) {
      if (segmentsCross(leaders[i]!, leaders[j]!)) return true;
    }
  }
  return false;
}

/** 一步力导向：互斥（标签与标签、标签与圆点、标签与别人的连线）+ 弹簧（拉回自己的圆点）+ 边界 */
function relaxStep(bodies: Body[], options: LabelOptions, step: number) {
  const { height, padding, bounds, gap } = options;
  const n = bodies.length;
  const fx = new Array<number>(n).fill(0);
  const fy = new Array<number>(n).fill(0);
  const rects = bodies.map((b) => rectOf(b, height));

  // 标签之间：重叠（含空隙）时沿重叠较小的方向推开
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left) + padding;
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + padding;
      if (ox <= 0 || oy <= 0) continue;
      const dx = bodies[j]!.cx - bodies[i]!.cx;
      const dy = bodies[j]!.cy - bodies[i]!.cy;
      if (ox < oy * 2.5) {
        const sx = dx !== 0 ? Math.sign(dx) : i % 2 === 0 ? -1 : 1;
        fx[i]! -= sx * ox * 0.75;
        fx[j]! += sx * ox * 0.75;
      } else {
        const sy = dy !== 0 ? Math.sign(dy) : i % 2 === 0 ? -1 : 1;
        fy[i]! -= sy * oy * 0.75;
        fy[j]! += sy * oy * 0.75;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const body = bodies[i]!;
    const rect = rects[i]!;
    // 标签与圆点（包括自己的）：压到圆点时推开，圆点始终完全可见
    for (const other of bodies) {
      const { x, y, r } = other.req;
      const px = Math.min(Math.max(x, rect.left), rect.right);
      const py = Math.min(Math.max(y, rect.top), rect.bottom);
      const d = Math.hypot(x - px, y - py);
      const need = r + padding + 6;
      if (d >= need) continue;
      if (d > 1e-6) {
        fx[i]! += ((px - x) / d) * (need - d) * 2;
        fy[i]! += ((py - y) / d) * (need - d) * 2;
      } else {
        // 圆点在标签里面：往离圆点近的那条边推出去
        const toLeft = x - rect.left + need;
        const toRight = rect.right - x + need;
        const toTop = y - rect.top + need;
        const toBottom = rect.bottom - y + need;
        const m = Math.min(toLeft, toRight, toTop, toBottom);
        if (m === toLeft) fx[i]! += toLeft;
        else if (m === toRight) fx[i]! -= toRight;
        else if (m === toTop) fy[i]! += toTop;
        else fy[i]! -= toBottom;
      }
    }

    // 弹簧：标签离自己圆点的最近距离保持在 r + gap 左右
    const { x, y, r } = body.req;
    const px = Math.min(Math.max(x, rect.left), rect.right);
    const py = Math.min(Math.max(y, rect.top), rect.bottom);
    const d = Math.hypot(px - x, py - y);
    const rest = r + gap;
    if (d > rest) {
      const k = 0.05;
      fx[i]! -= ((px - x) / d) * (d - rest) * k;
      fy[i]! -= ((py - y) / d) * (d - rest) * k;
    }

    // 别人的连线穿过这个标签：往连线的一侧让开
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const seg = leaderOf(bodies[j]!, height);
      if (!segmentHitsRect(seg, rect)) continue;
      const lx = seg.x2 - seg.x1;
      const ly = seg.y2 - seg.y1;
      const len = Math.hypot(lx, ly) || 1;
      let nx = -ly / len;
      let ny = lx / len;
      if ((body.cx - seg.x1) * nx + (body.cy - seg.y1) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      fx[i]! += nx * 6;
      fy[i]! += ny * 6;
    }
  }

  for (let i = 0; i < n; i++) {
    const b = bodies[i]!;
    b.cx += fx[i]! * step;
    b.cy += fy[i]! * step;
    clampInto(b, bounds, height);
  }
}

export function layoutLabels(
  requests: readonly LabelRequest[],
  options: LabelOptions,
): PlacedLabel[] {
  const { height } = options;
  const iterations = options.iterations ?? 600;
  const ordered = [...requests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bodies = ordered.map((req) => initialBody(req, ordered, options));
  for (const b of bodies) clampInto(b, options.bounds, height);

  for (let it = 0; it < iterations; it++) {
    // 步长逐渐变小，最后稳定下来
    const step = 0.9 - (0.6 * it) / iterations;
    relaxStep(bodies, options, step);
    if (it % 25 === 24) uncross(bodies, height);
  }
  // 收尾：交换消除交叉、把压到圆点的标签挪开，交替进行直到两者都满足（或到上限）
  // 目标依次是：连线不交叉、标签不压圆点、标签不互相重叠、连线不穿过别的标签
  for (let round = 0; round < 60; round++) {
    if (round > 0) for (let k = 0; k < 8; k++) relaxStep(bodies, options, 0.5);
    uncross(bodies, height);
    clearDots(bodies, options);
    if (
      !hasCrossing(bodies, height) &&
      !hasDotOverlap(bodies, options) &&
      !hasLabelConflict(bodies, height)
    ) {
      break;
    }
  }
  if (hasLabelConflict(bodies, height) || hasDotOverlap(bodies, options)) {
    repair(bodies, options);
    clearDots(bodies, options);
  }
  // 连线不交叉优先：仍有交叉时再交换一次（圆点画在标签上面，始终完全可见）
  if (hasCrossing(bodies, height)) uncross(bodies, height);

  const byId = new Map(
    bodies.map((b) => {
      const rect = rectOf(b, height);
      return [
        b.req.id,
        {
          id: b.req.id,
          left: rect.left,
          top: rect.top,
          width: b.req.width,
          height,
          leader: leaderOf(b, height),
        } satisfies PlacedLabel,
      ];
    }),
  );
  return requests.map((r) => byId.get(r.id)!);
}
