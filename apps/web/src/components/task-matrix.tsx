'use client';

import {
  BASE_TIER_DAYS,
  MATRIX_COLUMNS,
  MATRIX_ROWS,
  MATRIX_URGENT_FIRST_COLUMN,
  MAX_TIER_INDEX,
  OVERDUE_COLUMN,
  packBandLabels,
  type Category,
  type MatrixPoint,
} from '@alethego/core';
import { useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

import { CategoryDot } from './category-dot';
import { usePanels } from './panel-provider';
import { QUADRANT_LABELS, TIER_BOUNDARY_LABELS, formatDeadline } from '@/lib/format';

/**
 * 时间管理矩阵：X = 紧迫度（越靠右越紧急），Y = 重要性（越靠上越重要）。
 *
 * X 轴：14 格全部等宽，按剩余时间分档；刻度名标在分界线上，中线（两周）左右各 7 格，最右格为逾期。
 * Y 轴：刻度 0–5 标在分界线上，重要性 N 落在标 N 那条线上方的一格（N = 5 是最上面一格）；
 * 中线在刻度 3 上，下面三格是 0、1、2，上面三格是 3、4、5。
 * 不画格子网格线，只画区分四个象限的两条细线。每个任务显示为「分类色标 + 标题」标签，
 * 同一格内的标签纵向避让，放不下的收进"+N"。
 */

const VIEW_W = 1120;
const VIEW_H = 740;
const M = { top: 30, right: 12, bottom: 46, left: 64 };
const PLOT_W = VIEW_W - M.left - M.right;
const PLOT_H = VIEW_H - M.top - M.bottom;
const COL_W = PLOT_W / MATRIX_COLUMNS;
const ROW_H = PLOT_H / MATRIX_ROWS;
/** 中线：紧急区第一列（(7,14] 档）的左边界 */
const FIRST_URGENT_COLUMN = MATRIX_URGENT_FIRST_COLUMN;
/** 重要区：重要性 3–5（上三） */
const FIRST_IMPORTANT_ROW = 3;

/** 标签尺寸（viewBox 单位） */
const LABEL_H = 22;
const LABEL_GAP = 3;
const LABEL_FONT = 13;
const MARKER_R = 4.5;
/** 标签：左留白 + 色标 + 间距 | 标题 | 右留白 */
const LABEL_TEXT_OFFSET = 8 + MARKER_R * 2 + 5;
const LABEL_PADDING_RIGHT = 8;
/** 逾期标签：左留白 | 标题 | "逾期N天" | 点位（分类色 + 红色外圈）| 右留白 */
const OVERDUE_TEXT_OFFSET = 10;
const OVERDUE_POINT_R = 5;
const OVERDUE_POINT_PAD = 8;
const OVERDUE_POINT_ZONE = OVERDUE_POINT_R * 2 + OVERDUE_POINT_PAD + 6;
/** 标题最多显示约 10 个汉字宽；最小宽度约 3 个汉字 */
const MAX_TITLE_WIDTH = 130;
const MIN_TITLE_WIDTH = 40;
const OVERDUE_SUFFIX_WIDTH = 52;
const OVERFLOW_W = 36;

const colX = (column: number) => M.left + column * COL_W;
const colW = () => COL_W;
/** 重要性 row 所在一格的顶边（重要性 N 在标 N 那条线上方的一格） */
const rowTop = (row: number) => M.top + (MATRIX_ROWS - 1 - row) * ROW_H;
/** 重要性刻度 v（0–5）所在分界线的 y：第 v 格的下边 */
const valueY = (v: number) => M.top + (MATRIX_ROWS - v) * ROW_H;
const PLOT_RIGHT = colX(OVERDUE_COLUMN) + colW();
/** 逾期点位的中心：最右格靠右 */
const OVERDUE_POINT_X = PLOT_RIGHT - 2 - OVERDUE_POINT_PAD - OVERDUE_POINT_R;

/** 逾期标签的宽度拆分 */
const overdueChrome = OVERDUE_TEXT_OFFSET + OVERDUE_SUFFIX_WIDTH + OVERDUE_POINT_ZONE;

/** 按字符估算宽度（中日韩等全角字符按字号，其余按 0.6 倍字号），超出则截断加"…" */
function fitText(text: string, maxWidth: number, fontSize = LABEL_FONT): string {
  const widthOf = (ch: string) => (/[⺀-￿]/.test(ch) ? fontSize : fontSize * 0.6);
  let width = 0;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    width += widthOf(chars[i]!);
    if (width > maxWidth) {
      let out = chars.slice(0, i).join('');
      let outWidth = width - widthOf(chars[i]!);
      while (out && outWidth + fontSize > maxWidth) {
        const last = Array.from(out).pop()!;
        out = out.slice(0, -last.length);
        outWidth -= widthOf(last);
      }
      return `${out}…`;
    }
  }
  return text;
}

/** 分类色标：多分类按切片显示 */
function Marker({ colors, r = MARKER_R }: { colors: readonly string[]; r?: number }) {
  if (colors.length <= 1) {
    return (
      <circle
        r={r}
        className={colors.length === 0 ? 'marker-uncategorized' : undefined}
        style={colors[0] ? { fill: colors[0] } : undefined}
      />
    );
  }
  const step = (Math.PI * 2) / colors.length;
  return (
    <>
      {colors.map((color, i) => {
        const a0 = -Math.PI / 2 + i * step;
        const a1 = a0 + step;
        const d = [
          'M 0 0',
          `L ${r * Math.cos(a0)} ${r * Math.sin(a0)}`,
          `A ${r} ${r} 0 ${step > Math.PI ? 1 : 0} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)}`,
          'Z',
        ].join(' ');
        return <path key={i} d={d} style={{ fill: color }} />;
      })}
    </>
  );
}

function describeDeadline(point: MatrixPoint, now: Date, timeZone: string): string {
  if (point.urgency.kind === 'overdue') {
    return point.overdueDays === 0 ? '今天已过截止时刻' : `逾期 ${point.overdueDays} 天`;
  }
  const shown = point.representative.occurrenceAt ?? point.task.deadlineAt;
  if (!shown) return '无截止时间';
  const text = formatDeadline(shown, now, timeZone);
  return point.representative.occurrenceAt ? `本次 ${text}` : text;
}

/** 逾期天数按日历天计算；当天已过截止时刻的（0 天）标"今天已过" */
const overdueText = (days: number | null) => (days === 0 ? '今天已过' : `逾期${days}天`);

/** 估算文本宽度 */
function textWidth(text: string, fontSize = LABEL_FONT): number {
  let width = 0;
  for (const ch of Array.from(text))
    width += /[\u2e80-\uffff]/.test(ch) ? fontSize : fontSize * 0.6;
  return width;
}

/** 标签除标题外占用的宽度 */
function labelChrome(point: MatrixPoint): number {
  return point.overdueDays !== null ? overdueChrome : LABEL_TEXT_OFFSET + LABEL_PADDING_RIGHT;
}

interface PlacedLabel {
  point: MatrixPoint;
  x: number;
  y: number;
  width: number;
  anchorX: number;
  displaced: boolean;
  /** 标题可用宽度 */
  titleWidth: number;
}

interface OverflowChip {
  key: string;
  points: MatrixPoint[];
  x: number;
  y: number;
  width: number;
}

/**
 * 按重要性区间（横带）排布标题标签：锚定在所属紧迫度列的中心，可比列更宽；
 * 更紧急的先放，同一横带内互不重叠，放不下的收进所在格子的"+N"。
 */
function layoutLabels(points: readonly MatrixPoint[]) {
  const labels: PlacedLabel[] = [];
  const overflows: OverflowChip[] = [];
  for (let row = 0; row < MATRIX_ROWS; row++) {
    const inBand = points.filter((p) => p.row === row);
    if (inBand.length === 0) continue;
    const packed = packBandLabels(
      inBand.map((point) => {
        const overdue = point.overdueDays !== null;
        const chrome = labelChrome(point);
        const title = Math.min(MAX_TITLE_WIDTH, textWidth(point.task.title));
        return {
          item: point,
          // 逾期：点位在最右格靠右，画在标签内部的右端；标题在点位左边向左伸展，与其他标签互相避让
          anchorX: overdue ? OVERDUE_POINT_X : colX(point.column) + colW() / 2,
          align: overdue ? ('end' as const) : ('center' as const),
          endOffset: OVERDUE_POINT_R + OVERDUE_POINT_PAD,
          desiredY: rowTop(row) + (1 - point.offsetY) * ROW_H,
          width: chrome + Math.max(title, 12),
          minWidth: chrome + Math.min(title, MIN_TITLE_WIDTH),
          // 越紧急（越靠右）越先放
          priority: point.column,
          group: `${point.column}:${row}`,
        };
      }),
      {
        top: rowTop(row),
        height: ROW_H,
        left: M.left + 2,
        right: PLOT_RIGHT - 2,
        laneHeight: LABEL_H + LABEL_GAP,
        padding: 4,
        gap: 4,
        overflowWidth: OVERFLOW_W,
      },
    );
    for (const { item, x, y, width, anchorX, displaced } of packed.placed) {
      labels.push({
        point: item,
        x,
        y,
        width,
        anchorX,
        displaced,
        titleWidth: width - labelChrome(item),
      });
    }
    for (const { group, items, x, y, width } of packed.overflow) {
      overflows.push({ key: group, points: items, x, y, width });
    }
  }
  return { labels, overflows };
}

type Tooltip =
  | { kind: 'task'; point: MatrixPoint; left: number; top: number; below: boolean }
  | { kind: 'overflow'; points: MatrixPoint[]; left: number; top: number; below: boolean };

/** 提示框大致高度；上方空间不足时显示在下方 */
const TOOLTIP_SPACE = 110;

export function TaskMatrix({
  points,
  categoriesByTask,
  now,
  timeZone,
}: {
  points: readonly MatrixPoint[];
  categoriesByTask: (taskId: string) => Category[];
  now: Date;
  timeZone: string;
}) {
  const { open } = usePanels();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const { labels, overflows } = useMemo(() => layoutLabels(points), [points]);

  // 窄屏下矩阵可横向滚动：初始滚到最右侧，先看到紧急区
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, []);

  function anchor(event: PointerEvent<Element> | FocusEvent<Element>) {
    const wrapper = wrapperRef.current!;
    const box = event.currentTarget.getBoundingClientRect();
    const origin = wrapper.getBoundingClientRect();
    const below = box.top - origin.top < TOOLTIP_SPACE;
    return {
      left: box.left + box.width / 2 - origin.left,
      top: below ? box.bottom - origin.top : box.top - origin.top,
      below,
    };
  }
  const hideTooltip = () => setTooltip(null);

  const urgentX = colX(FIRST_URGENT_COLUMN);
  const importantY = valueY(FIRST_IMPORTANT_ROW);

  return (
    <div className="matrix-wrapper" ref={wrapperRef}>
      <div className="matrix-scroll" ref={scrollRef} onScroll={hideTooltip}>
        <svg
          className="matrix"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={`时间管理矩阵，共 ${points.length} 个任务`}
        >
          {/* 最右格：逾期 */}
          <rect
            className="matrix-overdue-strip"
            x={colX(OVERDUE_COLUMN)}
            y={M.top}
            width={colW()}
            height={PLOT_H}
          />

          {/* 坐标轴与象限分界（不画格子网格线） */}
          <line className="matrix-axis" x1={M.left} x2={M.left} y1={M.top} y2={M.top + PLOT_H} />
          <line
            className="matrix-axis"
            x1={M.left}
            x2={PLOT_RIGHT}
            y1={M.top + PLOT_H}
            y2={M.top + PLOT_H}
          />
          <line
            className="matrix-divider"
            x1={urgentX}
            x2={urgentX}
            y1={M.top}
            y2={M.top + PLOT_H}
          />
          <line
            className="matrix-divider"
            x1={M.left}
            x2={PLOT_RIGHT}
            y1={importantY}
            y2={importantY}
          />

          {/* 区域说明 */}
          <text className="matrix-region" x={(M.left + urgentX) / 2} y={M.top - 12}>
            不紧急
          </text>
          <text className="matrix-region" x={(urgentX + PLOT_RIGHT) / 2} y={M.top - 12}>
            紧急
          </text>
          <text
            className="matrix-region"
            transform={`translate(16 ${(M.top + importantY) / 2}) rotate(-90)`}
          >
            重要
          </text>
          <text
            className="matrix-region"
            transform={`translate(16 ${(importantY + M.top + PLOT_H) / 2}) rotate(-90)`}
          >
            不重要
          </text>

          {/* Y 轴刻度：0–5 标在分界线上（重要性 N 在标 N 那条线上方的一格） */}
          {Array.from({ length: MATRIX_ROWS }, (_, v) => (
            <g key={v} data-testid="matrix-y-tick">
              <line
                className="matrix-axis"
                x1={M.left - 4}
                x2={M.left}
                y1={valueY(v)}
                y2={valueY(v)}
              />
              <text
                className="matrix-tick"
                x={M.left - 8}
                y={valueY(v)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {v}
              </text>
            </g>
          ))}

          {/* X 轴刻度：名称标在分界线上（各档所在格子的左边界）；最右格标"逾期" */}
          {Array.from({ length: OVERDUE_COLUMN }, (_, column) => {
            const days = BASE_TIER_DAYS[MAX_TIER_INDEX - column]!;
            const x = colX(column);
            return (
              <g key={column} data-testid="matrix-x-tick" data-days={days}>
                <line
                  className="matrix-axis"
                  x1={x}
                  x2={x}
                  y1={M.top + PLOT_H}
                  y2={M.top + PLOT_H + 4}
                />
                <text
                  className={`matrix-tick${column === FIRST_URGENT_COLUMN ? ' matrix-tick-mid' : ''}`}
                  x={x}
                  y={M.top + PLOT_H + 17}
                  textAnchor="middle"
                >
                  {TIER_BOUNDARY_LABELS[days]}
                </text>
              </g>
            );
          })}
          <text
            className="matrix-tick"
            data-testid="matrix-x-overdue"
            x={colX(OVERDUE_COLUMN) + colW() / 2}
            y={M.top + PLOT_H + 17}
            textAnchor="middle"
          >
            逾期
          </text>
          <text className="matrix-axis-title" x={(M.left + PLOT_RIGHT) / 2} y={VIEW_H - 6}>
            截止时间（越靠右越紧急）
          </text>

          {/* 任务标签 */}
          {/* 被挤到旁边的标签：引线指回所属列 */}
          {labels
            .filter((l) => l.displaced)
            .map(({ point, x, y, width, anchorX }) => {
              const edge = anchorX < x ? x - width / 2 : x + width / 2;
              return (
                <g key={`leader-${point.task.id}`} className="matrix-leader" aria-hidden>
                  <line x1={anchorX} y1={y} x2={edge} y2={y} />
                  <circle cx={anchorX} cy={y} r={2.5} />
                </g>
              );
            })}

          {labels.map(({ point, x, y, width, anchorX, titleWidth }) => {
            const colors = categoriesByTask(point.task.id).map((c) => c.color);
            const openPanel = () => {
              hideTooltip();
              open({ kind: 'edit', taskId: point.task.id, surface: 'floating' });
            };
            const overdue = point.overdueDays !== null;
            const left = -width / 2;
            const label = [
              point.task.title,
              describeDeadline(point, now, timeZone),
              `重要性 ${point.task.importanceLevel}`,
              QUADRANT_LABELS[point.quadrant],
            ].join('，');
            return (
              <g
                key={point.task.id}
                role="button"
                tabIndex={0}
                className={`matrix-node${overdue ? ' matrix-node-overdue' : ''}`}
                aria-label={label}
                data-task-id={point.task.id}
                data-quadrant={point.quadrant}
                data-column={point.column}
                data-row={point.row}
                data-panel-anchor
                onClick={openPanel}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openPanel();
                  }
                }}
                onPointerEnter={(event) => setTooltip({ kind: 'task', point, ...anchor(event) })}
                onPointerLeave={hideTooltip}
                onFocus={(event) => setTooltip({ kind: 'task', point, ...anchor(event) })}
                onBlur={hideTooltip}
              >
                <g transform={`translate(${x} ${y})`}>
                  {/* 命中区域比标签略大 */}
                  <rect
                    className="node-hit"
                    x={left - 2}
                    y={-LABEL_H / 2 - 3}
                    width={width + 4}
                    height={LABEL_H + 6}
                  />
                  <rect
                    className="node-body"
                    x={left}
                    y={-LABEL_H / 2}
                    width={width}
                    height={LABEL_H}
                    rx={LABEL_H / 2}
                  />
                  {!overdue && (
                    <g transform={`translate(${left + 8 + MARKER_R} 0)`}>
                      <Marker colors={colors} />
                    </g>
                  )}
                  <text
                    className="node-title"
                    x={left + (overdue ? OVERDUE_TEXT_OFFSET : LABEL_TEXT_OFFSET)}
                    dominantBaseline="central"
                  >
                    {fitText(point.task.title, titleWidth)}
                  </text>
                  {overdue && (
                    <>
                      <text
                        className="node-overdue"
                        x={width / 2 - OVERDUE_POINT_ZONE + 4}
                        textAnchor="end"
                        dominantBaseline="central"
                      >
                        {overdueText(point.overdueDays)}
                      </text>
                      {/* 唯一的点位：在标签内部右端，分类颜色（多分类按切片）+ 红色外圈 */}
                      <g className="overdue-point" transform={`translate(${anchorX - x} 0)`}>
                        <Marker colors={colors} r={OVERDUE_POINT_R} />
                        <circle className="overdue-point-ring" r={OVERDUE_POINT_R + 1.5} />
                      </g>
                    </>
                  )}
                </g>
              </g>
            );
          })}

          {/* 放不下的任务 */}
          {overflows.map(({ key, points: hidden, x, y, width }) => (
            <g
              key={key}
              className="matrix-overflow"
              tabIndex={0}
              role="button"
              aria-label={`还有 ${hidden.length} 个任务：${hidden.map((p) => p.task.title).join('、')}`}
              onPointerEnter={(event) =>
                setTooltip({ kind: 'overflow', points: hidden, ...anchor(event) })
              }
              onPointerLeave={hideTooltip}
              onFocus={(event) =>
                setTooltip({ kind: 'overflow', points: hidden, ...anchor(event) })
              }
              onBlur={hideTooltip}
            >
              <rect
                x={x - width / 2}
                y={y - LABEL_H / 2}
                width={width}
                height={LABEL_H}
                rx={LABEL_H / 2}
              />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central">
                +{hidden.length}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {tooltip && (
        <div
          className={`matrix-tooltip${tooltip.below ? ' matrix-tooltip-below' : ''}`}
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {tooltip.kind === 'task' ? (
            <>
              <strong className="matrix-tooltip-title">{tooltip.point.task.title}</strong>
              <span className={tooltip.point.overdueDays !== null ? 'matrix-tooltip-overdue' : ''}>
                {describeDeadline(tooltip.point, now, timeZone)}
              </span>
              <span>
                重要性 {tooltip.point.task.importanceLevel} ·{' '}
                {QUADRANT_LABELS[tooltip.point.quadrant]}
              </span>
              {categoriesByTask(tooltip.point.task.id).map((category) => (
                <span key={category.id} className="task-category">
                  <CategoryDot color={category.color} />
                  {category.name}
                </span>
              ))}
            </>
          ) : (
            <>
              <strong className="matrix-tooltip-title">还有 {tooltip.points.length} 个任务</strong>
              {tooltip.points.map((p) => (
                <span key={p.task.id}>{p.task.title}</span>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
