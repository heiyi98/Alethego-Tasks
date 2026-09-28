'use client';

import {
  MATRIX_COLUMNS,
  MATRIX_ROWS,
  OVERDUE_COLUMN,
  packBandLabels,
  type Category,
  type MatrixPoint,
} from '@alethego/core';
import { useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

import { CategoryDot } from './category-dot';
import { usePanels } from './panel-provider';
import { QUADRANT_LABELS, formatDeadline } from '@/lib/format';
import { MIDLINE_BOUNDARY, X_TICKS, boundaryX, overdueLaneCenter } from '@/lib/matrix-axis';

/**
 * 时间管理矩阵：X = 紧迫度（越靠右越紧急），Y = 重要性（越靠上越重要）。
 *
 * X 轴：14 格全部等宽，按日历日判档；刻度名标在分界线上，中线（两周）左右各 7 格；
 * 最右一格是逾期区（不写字），里面按逾期天数分三条窄道。
 * Y 轴：刻度 0–5 标在分界线上，重要性 N 落在标 N 那条线上方的一格；中线在刻度 3 上。
 *
 * 图里只出现四种文字：X 轴刻度名、Y 轴刻度数字、四个方位字、任务标题。
 * 普通任务的标签（色点 + 标题）整个落在所属格子内，在格内散布、互相避让，不贴刻度线；
 * 放不下时标题截短，再放不下只剩色点。
 */

const VIEW_W = 1120;
const VIEW_H = 720;
const M = { top: 30, right: 12, bottom: 26, left: 64 };
const PLOT_W = VIEW_W - M.left - M.right;
const PLOT_H = VIEW_H - M.top - M.bottom;
const COL_W = PLOT_W / MATRIX_COLUMNS;
const ROW_H = PLOT_H / MATRIX_ROWS;
/** 重要区：重要性 3–5（上三） */
const FIRST_IMPORTANT_ROW = 3;
/** 标签与格子两侧刻度线之间的留白 */
const CELL_MARGIN = 4;

/** 标签尺寸（viewBox 单位） */
const LABEL_H = 22;
const LABEL_GAP = 3;
const LABEL_FONT = 12;
const MARKER_R = 4;
/** 普通标签：左留白 + 色标 + 间距 | 标题 | 右留白 */
const LABEL_TEXT_OFFSET = 6 + MARKER_R * 2 + 4;
const LABEL_PADDING_RIGHT = 6;
const LABEL_CHROME = LABEL_TEXT_OFFSET + LABEL_PADDING_RIGHT;
/** 放不下标题时只剩色点 */
const DOT_W = MARKER_R * 2 + 8;
/** 截短时标题至少保留的宽度（约 1 个汉字加省略号） */
const SHORT_TITLE_W = 20;

/** 逾期标签：左留白 | 标题 | 间距 | 点位（分类色 + 红色外圈）| 右留白 */
const OVERDUE_POINT_R = 5;
const OVERDUE_TEXT_OFFSET = 8;
const OVERDUE_POINT_PAD = 6;
const OVERDUE_CHROME = OVERDUE_TEXT_OFFSET + 4 + OVERDUE_POINT_R * 2 + OVERDUE_POINT_PAD;
const OVERDUE_DOT_W = OVERDUE_POINT_R * 2 + OVERDUE_POINT_PAD * 2;
/** 逾期标签标题的最大宽度（约 10 个汉字），向左伸展 */
const MAX_OVERDUE_TITLE_W = 120;
const MIN_OVERDUE_TITLE_W = 36;

const colX = (column: number) => boundaryX(column, M.left, COL_W);
/** 重要性 row 所在一格的顶边（重要性 N 在标 N 那条线上方的一格） */
const rowTop = (row: number) => M.top + (MATRIX_ROWS - 1 - row) * ROW_H;
/** 重要性刻度 v（0–5）所在分界线的 y：第 v 格的下边 */
const valueY = (v: number) => M.top + (MATRIX_ROWS - v) * ROW_H;
const PLOT_RIGHT = colX(MATRIX_COLUMNS);
/** 逾期点位的中心：逾期格内对应的道 */
const overduePointX = (overdueDays: number) =>
  colX(OVERDUE_COLUMN) + overdueLaneCenter(overdueDays) * COL_W;

const isWide = (ch: string) => /[⺀-￿]/.test(ch);

/** 按字符估算宽度（中日韩等全角字符按字号，其余按 0.6 倍字号），超出则截断加"…" */
function fitText(text: string, maxWidth: number, fontSize = LABEL_FONT): string {
  const widthOf = (ch: string) => (isWide(ch) ? fontSize : fontSize * 0.6);
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

/** 估算文本宽度 */
function textWidth(text: string, fontSize = LABEL_FONT): number {
  let width = 0;
  for (const ch of Array.from(text)) width += isWide(ch) ? fontSize : fontSize * 0.6;
  return width;
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

interface PlacedLabel {
  point: MatrixPoint;
  x: number;
  y: number;
  width: number;
  /** 标题可用宽度；0 = 只剩色点 */
  titleWidth: number;
}

/**
 * 按重要性区间（横带）排布标签：
 * - 普通任务的标签限制在所属格子内（去掉贴近刻度线的留白），在格内按散布位置摆放、互相避让
 * - 逾期任务：点位在所在道的中心、画在标签内部右端，标签向左伸展
 */
function layoutLabels(points: readonly MatrixPoint[]): PlacedLabel[] {
  const labels: PlacedLabel[] = [];
  for (let row = 0; row < MATRIX_ROWS; row++) {
    const inBand = points.filter((p) => p.row === row);
    if (inBand.length === 0) continue;
    const placed = packBandLabels(
      inBand.map((point) => {
        const title = textWidth(point.task.title);
        const desiredY = rowTop(row) + (1 - point.offsetY) * ROW_H;
        if (point.overdueDays !== null) {
          const pointX = overduePointX(point.overdueDays);
          return {
            item: point,
            minX: M.left + 2,
            maxX: PLOT_RIGHT,
            desiredX: pointX,
            desiredY,
            fixedRight: pointX + OVERDUE_POINT_R + OVERDUE_POINT_PAD,
            widths: [
              OVERDUE_CHROME + Math.min(Math.max(title, 12), MAX_OVERDUE_TITLE_W),
              OVERDUE_CHROME + Math.min(title, MIN_OVERDUE_TITLE_W),
              OVERDUE_DOT_W,
            ],
            // 逾期的先放，越逾期越靠右越先
            priority: 100 + point.overdueDays,
          };
        }
        const minX = colX(point.column) + CELL_MARGIN;
        const maxX = colX(point.column + 1) - CELL_MARGIN;
        const room = maxX - minX - LABEL_CHROME;
        return {
          item: point,
          minX,
          maxX,
          desiredX: minX + point.offsetX * (maxX - minX),
          desiredY,
          widths: [
            LABEL_CHROME + Math.min(Math.max(title, 12), room),
            LABEL_CHROME + Math.min(title, SHORT_TITLE_W),
            DOT_W,
          ],
          // 越紧急（越靠右）越先放
          priority: point.column,
        };
      }),
      {
        top: rowTop(row),
        height: ROW_H,
        laneHeight: LABEL_H + LABEL_GAP,
        padding: 4,
        gap: 3,
      },
    );
    for (const { item, x, y, width, widthIndex, overlapping } of placed) {
      const isDot = widthIndex === 2 || (overlapping && width <= OVERDUE_DOT_W);
      const chrome = item.overdueDays !== null ? OVERDUE_CHROME : LABEL_CHROME;
      labels.push({ point: item, x, y, width, titleWidth: isDot ? 0 : width - chrome });
    }
  }
  return labels;
}

type Tooltip = { point: MatrixPoint; left: number; top: number; below: boolean };

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
  const labels = useMemo(() => layoutLabels(points), [points]);

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

  const urgentX = colX(MIDLINE_BOUNDARY);
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
          {/* 最右格：逾期区（不写字） */}
          <rect
            className="matrix-overdue-strip"
            x={colX(OVERDUE_COLUMN)}
            y={M.top}
            width={COL_W}
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

          {/* 四个方位字 */}
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

          {/* Y 轴刻度：0–5 标在分界线上 */}
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

          {/* X 轴刻度：名称标在分界线上 */}
          {X_TICKS.map(({ boundary, label }) => {
            const x = colX(boundary);
            return (
              <g key={boundary} data-testid="matrix-x-tick" data-boundary={boundary}>
                <line
                  className="matrix-axis"
                  x1={x}
                  x2={x}
                  y1={M.top + PLOT_H}
                  y2={M.top + PLOT_H + 4}
                />
                <text
                  className={`matrix-tick${boundary === MIDLINE_BOUNDARY ? ' matrix-tick-mid' : ''}`}
                  x={x}
                  y={M.top + PLOT_H + 17}
                  textAnchor="middle"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* 任务标签 */}
          {labels.map(({ point, x, y, width, titleWidth }) => {
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
                data-overdue-lane={overdue ? point.overdueDays : undefined}
                data-panel-anchor
                onClick={openPanel}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openPanel();
                  }
                }}
                onPointerEnter={(event) => setTooltip({ point, ...anchor(event) })}
                onPointerLeave={hideTooltip}
                onFocus={(event) => setTooltip({ point, ...anchor(event) })}
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
                  {overdue ? (
                    <>
                      {titleWidth > 0 && (
                        <text
                          className="node-title"
                          x={left + OVERDUE_TEXT_OFFSET}
                          dominantBaseline="central"
                        >
                          {fitText(point.task.title, titleWidth)}
                        </text>
                      )}
                      {/* 唯一的点位：在标签内部右端，分类颜色（多分类按切片）+ 红色外圈 */}
                      <g
                        className="overdue-point"
                        transform={`translate(${width / 2 - OVERDUE_POINT_PAD - OVERDUE_POINT_R} 0)`}
                      >
                        <Marker colors={colors} r={OVERDUE_POINT_R} />
                        <circle className="overdue-point-ring" r={OVERDUE_POINT_R + 1.5} />
                      </g>
                    </>
                  ) : titleWidth > 0 ? (
                    <>
                      <g transform={`translate(${left + 6 + MARKER_R} 0)`}>
                        <Marker colors={colors} />
                      </g>
                      <text
                        className="node-title"
                        x={left + LABEL_TEXT_OFFSET}
                        dominantBaseline="central"
                      >
                        {fitText(point.task.title, titleWidth)}
                      </text>
                    </>
                  ) : (
                    <Marker colors={colors} />
                  )}
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {tooltip && (
        <div
          className={`matrix-tooltip${tooltip.below ? ' matrix-tooltip-below' : ''}`}
          role="tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <strong className="matrix-tooltip-title">{tooltip.point.task.title}</strong>
          <span className={tooltip.point.overdueDays !== null ? 'matrix-tooltip-overdue' : ''}>
            {describeDeadline(tooltip.point, now, timeZone)}
          </span>
          <span>
            重要性 {tooltip.point.task.importanceLevel} · {QUADRANT_LABELS[tooltip.point.quadrant]}
          </span>
          {categoriesByTask(tooltip.point.task.id).map((category) => (
            <span key={category.id} className="task-category">
              <CategoryDot color={category.color} />
              {category.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
