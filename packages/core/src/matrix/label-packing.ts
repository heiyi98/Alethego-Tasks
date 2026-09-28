/**
 * 矩阵任务标签排布：同一重要性区间（一条横带）内的任务以标签显示。
 * 横带被分成若干等高的"泳道"；标签按优先级（更紧急的先放）依次放进离期望纵向位置最近、
 * 且水平方向不与已有标签重叠的泳道。
 *
 * - 普通任务：整个标签必须落在所属格子内（minX..maxX，表现层已去掉贴近刻度线的留白），
 *   在格内尽量靠近期望的横向位置（格内自由散布），不会被挤到别的格子里。
 * - 逾期任务（fixedRight）：点位在标签内部右端，标签右端固定，向左伸展。
 * - 放不下时依次改用更短的宽度（widths 从宽到窄，最后一项通常是只剩色点）；
 *   仍放不下时按最窄宽度放在期望位置（可能与其他标签重叠），不会丢失任何任务。
 *
 * 单位与像素无关，由表现层决定；Web 与 Mobile 共用。
 */

export interface LabelRequest<T> {
  item: T;
  /** 标签允许占用的水平范围 */
  minX: number;
  maxX: number;
  /** 期望的标签中心横坐标（格内散布位置） */
  desiredX: number;
  /** 期望的纵向中心位置 */
  desiredY: number;
  /** 候选宽度，从宽到窄 */
  widths: readonly number[];
  /** 越大越先放 */
  priority: number;
  /** 设定时标签右端固定在这里（逾期任务），标签向左伸展 */
  fixedRight?: number;
}

export interface BandSpec {
  top: number;
  height: number;
  laneHeight: number;
  /** 上下留白 */
  padding: number;
  /** 同一泳道内相邻标签的最小水平间距 */
  gap: number;
}

export interface PlacedLabel<T> {
  item: T;
  /** 标签中心 */
  x: number;
  y: number;
  width: number;
  /** 使用的是 widths 中的第几个（0 = 完整宽度） */
  widthIndex: number;
  /** 所有宽度都放不下，按最窄宽度叠放在期望位置 */
  overlapping: boolean;
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

function fits(lane: readonly Interval[], candidate: Interval, gap: number): boolean {
  return lane.every(
    (other) => candidate.to + gap <= other.from || candidate.from >= other.to + gap,
  );
}

const EPSILON = 1e-9;

/** 在一条泳道的 [minX, maxX] 内为宽度 width 找一个不重叠、离期望中心最近的位置 */
function findSlot(
  lane: readonly Interval[],
  request: LabelRequest<unknown>,
  width: number,
  gap: number,
): Interval | null {
  if (request.fixedRight !== undefined) {
    const candidate = { from: request.fixedRight - width, to: request.fixedRight };
    if (candidate.from < request.minX - EPSILON) return null;
    return fits(lane, candidate, gap) ? candidate : null;
  }
  if (width > request.maxX - request.minX + EPSILON) return null;
  const clampFrom = (from: number) => Math.max(request.minX, Math.min(from, request.maxX - width));
  const starts = [
    clampFrom(request.desiredX - width / 2),
    ...lane.flatMap((other) => [other.to + gap, other.from - gap - width]),
  ];
  let best: Interval | null = null;
  let bestDistance = Infinity;
  for (const from of starts) {
    if (from < request.minX - EPSILON || from + width > request.maxX + EPSILON) continue;
    const candidate = { from, to: from + width };
    if (!fits(lane, candidate, gap)) continue;
    const distance = Math.abs(from + width / 2 - request.desiredX);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function packOnce<T>(
  requests: readonly LabelRequest<T>[],
  band: BandSpec,
  firstWidth: (request: LabelRequest<T>) => number,
): PlacedLabel<T>[] {
  const centers = laneCenters(band);
  const lanes: Interval[][] = centers.map(() => []);
  const placed: PlacedLabel<T>[] = [];

  const ordered = [...requests].sort(
    (a, b) => b.priority - a.priority || b.desiredX - a.desiredX || a.desiredY - b.desiredY,
  );
  const lanesByDistance = (y: number) =>
    centers.map((c, i) => ({ i, d: Math.abs(c - y) })).sort((a, b) => a.d - b.d);

  for (const request of ordered) {
    const near = lanesByDistance(request.desiredY);
    let done = false;
    for (
      let widthIndex = firstWidth(request);
      widthIndex < request.widths.length && !done;
      widthIndex++
    ) {
      const width = request.widths[widthIndex]!;
      for (const { i } of near) {
        const slot = findSlot(lanes[i]!, request, width, band.gap);
        if (!slot) continue;
        lanes[i]!.push(slot);
        placed.push({
          item: request.item,
          x: (slot.from + slot.to) / 2,
          y: centers[i]!,
          width,
          widthIndex,
          overlapping: false,
        });
        done = true;
        break;
      }
    }
    if (!done) {
      // 实在放不下：最窄宽度叠放在期望位置所在的泳道（仍在自己的格子 / 道内）
      const widthIndex = request.widths.length - 1;
      const width = request.widths[widthIndex]!;
      const from =
        request.fixedRight !== undefined
          ? request.fixedRight - width
          : Math.max(request.minX, Math.min(request.desiredX - width / 2, request.maxX - width));
      const lane = near[0]!.i;
      lanes[lane]!.push({ from, to: from + width });
      placed.push({
        item: request.item,
        x: from + width / 2,
        y: centers[lane]!,
        width,
        widthIndex,
        overlapping: true,
      });
    }
  }
  return placed;
}

/** 同一格子（范围相同）的请求视为一组 */
const groupOf = (request: LabelRequest<unknown>) =>
  request.fixedRight !== undefined
    ? `end:${request.fixedRight}`
    : `${request.minX}:${request.maxX}`;

/**
 * 排布一条横带。某个格子太挤、出现叠放时，这一格的标签整体改从更短的宽度开始重排
 * （大家都截短，而不是先来的占满、后来的叠在一起），直到不再叠放或已经是最短宽度。
 */
export function packBandLabels<T>(
  requests: readonly LabelRequest<T>[],
  band: BandSpec,
): PlacedLabel<T>[] {
  const start = new Map<string, number>();
  const firstWidth = (request: LabelRequest<T>) =>
    Math.min(start.get(groupOf(request)) ?? 0, request.widths.length - 1);
  // 挤的格子里不再按散布位置居中，而是从格子左端依次排开，才能并排放下
  const arrange = () =>
    requests.map((r) =>
      r.fixedRight === undefined && (start.get(groupOf(r)) ?? 0) > 0
        ? { ...r, desiredX: r.minX }
        : r,
    );

  let placed = packOnce(arrange(), band, firstWidth);
  for (let round = 0; round < 8; round++) {
    const crowded = new Set(
      placed
        .filter((p) => p.overlapping)
        .map((p) => groupOf(requests.find((r) => r.item === p.item)!)),
    );
    const shrinkable = [...crowded].filter((group) =>
      requests.some((r) => groupOf(r) === group && firstWidth(r) < r.widths.length - 1),
    );
    if (shrinkable.length === 0) break;
    for (const group of shrinkable) start.set(group, (start.get(group) ?? 0) + 1);
    placed = packOnce(arrange(), band, firstWidth);
  }
  return placed;
}
