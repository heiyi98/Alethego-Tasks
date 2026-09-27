/**
 * 矩阵标题标签排布：同一重要性区间（一条横带）内的任务以标题标签显示。
 * 横带被分成若干等高的"泳道"；标签锚定在所属紧迫度列的中心，可以比列更宽，
 * 按优先级（更紧急的先放）依次放进离期望纵向位置最近、且水平方向不与已有标签重叠的泳道。
 * 锚点附近都被占时，标签可以整体移到锚点旁边（displaced，表现层画引线指回锚点）；
 * 仍放不下时缩短标签，再放不下的归入所在格子的"+N"溢出项。
 *
 * 单位与像素无关，由表现层决定；Web 与 Mobile 共用。
 */

export interface LabelRequest<T> {
  item: T;
  /** 锚点横坐标：所属列的中心 */
  anchorX: number;
  /** 期望的纵向中心位置 */
  desiredY: number;
  /** 完整标签宽度与最小可接受宽度（缩短后仍可读） */
  width: number;
  minWidth: number;
  /** 越大越先放 */
  priority: number;
  /** 溢出时归入的分组（通常是格子），同组溢出项合并为一个"+N" */
  group: string;
}

export interface BandSpec {
  top: number;
  height: number;
  /** 标签可占用的水平范围 */
  left: number;
  right: number;
  laneHeight: number;
  /** 上下留白 */
  padding: number;
  /** 同一泳道内相邻标签的最小水平间距 */
  gap: number;
  /** "+N" 溢出项的宽度 */
  overflowWidth: number;
}

export interface PlacedLabel<T> {
  item: T;
  /** 标签中心 */
  x: number;
  y: number;
  width: number;
  anchorX: number;
  /** 标签没有覆盖锚点（被挤到旁边），表现层应画一条引线指回锚点 */
  displaced: boolean;
}

export interface OverflowLabel<T> {
  group: string;
  items: T[];
  x: number;
  y: number;
  width: number;
}

export interface PackedBand<T> {
  placed: PlacedLabel<T>[];
  overflow: OverflowLabel<T>[];
}

interface Interval {
  from: number;
  to: number;
}

export function laneCenters(band: BandSpec): number[] {
  const count = Math.max(1, Math.floor((band.height - band.padding * 2) / band.laneHeight));
  const used = count * band.laneHeight;
  const start = band.top + (band.height - used) / 2;
  return Array.from({ length: count }, (_, i) => start + band.laneHeight * (i + 0.5));
}

/** 以锚点为中心的区间，超出左右边界时向内平移 */
function intervalAt(anchorX: number, width: number, band: BandSpec): Interval {
  let from = anchorX - width / 2;
  from = Math.max(band.left, Math.min(from, band.right - width));
  return { from, to: from + width };
}

function fits(lane: readonly Interval[], candidate: Interval, gap: number): boolean {
  return lane.every(
    (other) => candidate.to + gap <= other.from || candidate.from >= other.to + gap,
  );
}

export function packBandLabels<T>(
  requests: readonly LabelRequest<T>[],
  band: BandSpec,
): PackedBand<T> {
  const centers = laneCenters(band);
  const lanes: Interval[][] = centers.map(() => []);
  const placed: PlacedLabel<T>[] = [];
  const overflowGroups = new Map<string, { items: T[]; anchorX: number; desiredY: number }>();

  const ordered = [...requests].sort(
    (a, b) => b.priority - a.priority || b.anchorX - a.anchorX || a.desiredY - b.desiredY,
  );
  const lanesByDistance = (y: number) =>
    centers.map((c, i) => ({ i, d: Math.abs(c - y) })).sort((a, b) => a.d - b.d);

  for (const request of ordered) {
    const lanesNear = lanesByDistance(request.desiredY);
    // 候选顺序：完整宽度 → 缩短；每种宽度先不离开锚点（居中或小幅平移，锚点仍在标签内），
    // 再允许整体移到锚点左 / 右侧（由表现层画引线指回锚点）
    const attempts: { width: number; shift: number; displaced: boolean }[] = [];
    for (const width of [request.width, request.minWidth]) {
      const reach = Math.max(0, width / 2 - band.gap * 2);
      const side = width / 2 + band.gap * 2;
      for (const shift of [0, -reach, reach]) attempts.push({ width, shift, displaced: false });
      for (const shift of [-side, side, -(side + width / 2), side + width / 2]) {
        attempts.push({ width, shift, displaced: true });
      }
    }

    let done = false;
    for (const attempt of attempts) {
      for (const { i } of lanesNear) {
        const interval = intervalAt(request.anchorX + attempt.shift, attempt.width, band);
        if (!fits(lanes[i]!, interval, band.gap)) continue;
        lanes[i]!.push(interval);
        const x = (interval.from + interval.to) / 2;
        placed.push({
          item: request.item,
          x,
          y: centers[i]!,
          width: attempt.width,
          anchorX: request.anchorX,
          displaced: request.anchorX < interval.from || request.anchorX > interval.to,
        });
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) {
      const group = overflowGroups.get(request.group);
      if (group) group.items.push(request.item);
      else
        overflowGroups.set(request.group, {
          items: [request.item],
          anchorX: request.anchorX,
          desiredY: request.desiredY,
        });
    }
  }

  // "+N" 也尽量放进空位；实在没有空位时放在离锚点最近的泳道（可能与标签相邻重叠）
  const overflow: OverflowLabel<T>[] = [];
  for (const [group, { items, anchorX, desiredY }] of overflowGroups) {
    const interval = intervalAt(anchorX, band.overflowWidth, band);
    const order = lanesByDistance(desiredY);
    const free = order.find(({ i }) => fits(lanes[i]!, interval, band.gap));
    const lane = (free ?? order[order.length - 1]!).i;
    lanes[lane]!.push(interval);
    overflow.push({
      group,
      items,
      x: (interval.from + interval.to) / 2,
      y: centers[lane]!,
      width: band.overflowWidth,
    });
  }

  return { placed, overflow };
}
