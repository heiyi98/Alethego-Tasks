'use client';

import {
  MATRIX_COLUMNS,
  MATRIX_ROWS,
  layoutLabels,
  separateDots,
  type Category,
  type MatrixMode,
  type MatrixPoint,
  type MatrixSlot,
  type Rect,
} from '@alethego/core';
import { useEffect, useMemo, useRef } from 'react';

import { usePanels } from './panel-provider';
import { QUADRANT_LABELS, formatDeadline } from '@/lib/format';
import { MIDLINE_BOUNDARY, slotKey, xTicks } from '@/lib/matrix-axis';

/**
 * 时间管理矩阵：X = 紧迫度（越靠右越紧急），Y = 重要性（越靠上越重要）。
 *
 * X 轴：短期 / 长期两种模式都是 6 个等宽的格子，按日历日判档，刻度名标在分界线上，中线在 6 格正中；
 * 逾期区接在 6 格最右边（1/4 格宽，不写字）；没设截止日期的任务贴在图的最左边缘。
 * Y 轴：刻度 0–5 标在分界线上，重要性 N 落在标 N 那条线上方的一格；中线在刻度 3 上。
 *
 * 图里只出现四种文字：X 轴刻度名、Y 轴刻度数字、四个方位字、任务标题。
 * 圆点是任务的位置，永远在所属格子里；标签（写在细横线上的标题）用力导向算法排布，
 * 可以在圆点的任意一侧、可以伸出格子，用一条细线连回自己的圆点。
 */

const VIEW_W = 1120;
const VIEW_H = 720;
const M = { top: 30, right: 12, bottom: 26, left: 64 };
/** 逾期区的宽度（格） */
const OVERDUE_CELLS = 0.25;
const PLOT_W = VIEW_W - M.left - M.right;
const PLOT_H = VIEW_H - M.top - M.bottom;
const COL_W = PLOT_W / (MATRIX_COLUMNS + OVERDUE_CELLS);
const ROW_H = PLOT_H / MATRIX_ROWS;
/** 重要区：重要性 3–5（上三） */
const FIRST_IMPORTANT_ROW = 3;

/** 圆点 */
const DOT_R = 5;
/** 逾期圆点外的红圈 */
const RING_R = DOT_R + 1.5;
/** 圆点之间至少留的空隙 */
const DOT_GAP = 3;
/** 圆点离格子边、刻度线至少这么远 */
const CELL_INSET = 8;

/** 标签：标题最多相当于 6 个汉字宽，超出用省略号 */
const LABEL_FONT = 12;
const MAX_TITLE_W = LABEL_FONT * 6;
const TEXT_PAD = 1;

const colX = (boundary: number) => M.left + boundary * COL_W;
/** 重要性 row 所在一格的顶边（重要性 N 在标 N 那条线上方的一格） */
const rowTop = (row: number) => M.top + (MATRIX_ROWS - 1 - row) * ROW_H;
/** 重要性刻度 v（0–5）所在分界线的 y：第 v 格的下边 */
const valueY = (v: number) => M.top + (MATRIX_ROWS - v) * ROW_H;
const OVERDUE_LEFT = colX(MATRIX_COLUMNS);
const PLOT_RIGHT = OVERDUE_LEFT + COL_W * OVERDUE_CELLS;

const isWide = (ch: string) => /[⺀-￿]/.test(ch);
const charWidth = (ch: string) => (isWide(ch) ? LABEL_FONT : LABEL_FONT * 0.6);

/** 按字符估算宽度（中日韩等全角字符按字号，其余按 0.6 倍字号），超出 maxWidth 截断加"…" */
function fitTitle(text: string, maxWidth = MAX_TITLE_W): { text: string; width: number } {
  const chars = Array.from(text);
  const full = chars.reduce((sum, ch) => sum + charWidth(ch), 0);
  if (full <= maxWidth) return { text, width: full };
  const ellipsis = LABEL_FONT;
  let width = 0;
  let out = '';
  for (const ch of chars) {
    if (width + charWidth(ch) + ellipsis > maxWidth) break;
    out += ch;
    width += charWidth(ch);
  }
  return { text: `${out}…`, width: width + ellipsis };
}

/** 分类色标：多分类按切片显示 */
function Marker({ colors, r = DOT_R }: { colors: readonly string[]; r?: number }) {
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

/** 读屏文字（不显示） */
function describeDeadline(point: MatrixPoint, now: Date, timeZone: string): string {
  if (point.urgency.kind === 'overdue') {
    return point.overdueDays === 0 ? '今天已过截止时刻' : `逾期 ${point.overdueDays} 天`;
  }
  const shown = point.representative.occurrenceAt ?? point.task.deadlineAt;
  if (!shown) return '无截止时间';
  const text = formatDeadline(shown, now, timeZone);
  return point.representative.occurrenceAt ? `本次 ${text}` : text;
}

/** 圆点中心允许的范围：所属格子（× 重要性一行）的内部，不贴格子边和刻度线 */
function dotRegion(slot: MatrixSlot, row: number): Rect {
  const r = slot.kind === 'overdue' ? RING_R : DOT_R;
  const top = rowTop(row) + r + CELL_INSET;
  const bottom = rowTop(row) + ROW_H - r - CELL_INSET;
  switch (slot.kind) {
    case 'cell':
      return {
        left: colX(slot.column) + r + CELL_INSET,
        right: colX(slot.column + 1) - r - CELL_INSET,
        top,
        bottom,
      };
    case 'overdue': {
      const inset = Math.min(CELL_INSET, (PLOT_RIGHT - OVERDUE_LEFT) / 2 - r);
      return { left: OVERDUE_LEFT + r + inset, right: PLOT_RIGHT - r - inset, top, bottom };
    }
    case 'no_deadline':
      // 贴在图的最左边缘，完整可见
      return { left: M.left + r + 1, right: M.left + r + 1, top, bottom };
  }
}

/** 标签高度（文字 + 下面的细横线） */
const LABEL_H = 17;
/** 文字基线在标签底边上方多少 */
const TEXT_BASELINE = 4;

interface Drawn {
  point: MatrixPoint;
  slot: MatrixSlot;
  x: number;
  y: number;
  r: number;
  title: string;
  label: ReturnType<typeof layoutLabels>[number];
}

function layout(points: readonly MatrixPoint[]): Drawn[] {
  const onChart = points.filter((p): p is MatrixPoint & { slot: MatrixSlot } => p.slot !== null);
  const dots = separateDots(
    onChart.map((point) => {
      const region = dotRegion(point.slot, point.row);
      return {
        id: point.task.id,
        x: region.left + point.offsetX * (region.right - region.left),
        y: region.bottom - point.offsetY * (region.bottom - region.top),
        r: point.slot.kind === 'overdue' ? RING_R : DOT_R,
        region,
      };
    }),
    DOT_GAP,
  );
  const titles = new Map(onChart.map((p) => [p.task.id, fitTitle(p.task.title)]));
  const labels = layoutLabels(
    onChart.map((point) => {
      const dot = dots.get(point.task.id)!;
      return {
        id: point.task.id,
        x: dot.x,
        y: dot.y,
        r: point.slot.kind === 'overdue' ? RING_R : DOT_R,
        width: titles.get(point.task.id)!.width + TEXT_PAD * 2,
      };
    }),
    {
      bounds: { left: M.left + 2, right: VIEW_W - 2, top: M.top + 2, bottom: M.top + PLOT_H - 2 },
      height: LABEL_H,
      gap: 4,
      padding: 2,
    },
  );
  return onChart.map((point, i) => {
    const dot = dots.get(point.task.id)!;
    const title = titles.get(point.task.id)!;
    return {
      point,
      slot: point.slot,
      x: dot.x,
      y: dot.y,
      r: point.slot.kind === 'overdue' ? RING_R : DOT_R,
      title: title.text,
      label: labels[i]!,
    };
  });
}

export function TaskMatrix({
  points,
  mode,
  categoriesByTask,
  now,
  timeZone,
}: {
  points: readonly MatrixPoint[];
  mode: MatrixMode;
  categoriesByTask: (taskId: string) => Category[];
  now: Date;
  timeZone: string;
}) {
  const { open } = usePanels();
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawn = useMemo(() => layout(points), [points]);
  const ticks = xTicks(mode);

  // 窄屏下矩阵可横向滚动：初始滚到最右侧，先看到紧急区
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, []);

  const urgentX = colX(MIDLINE_BOUNDARY);
  const importantY = valueY(FIRST_IMPORTANT_ROW);
  const openPanel = (taskId: string) => open({ kind: 'edit', taskId, surface: 'floating' });

  return (
    <div className="matrix-wrapper">
      <div className="matrix-scroll" ref={scrollRef}>
        <svg
          className="matrix"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={`时间管理矩阵，共 ${drawn.length} 个任务`}
          data-mode={mode}
        >
          {/* 逾期区：接在 6 格最右边，1/4 格宽，不写字 */}
          <rect
            className="matrix-overdue-strip"
            x={OVERDUE_LEFT}
            y={M.top}
            width={PLOT_RIGHT - OVERDUE_LEFT}
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
          <text className="matrix-region" x={(urgentX + OVERDUE_LEFT) / 2} y={M.top - 12}>
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
          {ticks.map(({ boundary, label }) => {
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

          {/* 任务标签：力导向排布，标题写在细横线上，一条细线连回圆点 */}
          {drawn.map(({ point, slot, title, label }) => {
            const overdue = slot.kind === 'overdue';
            const aria = [
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
                aria-label={aria}
                data-task-id={point.task.id}
                data-quadrant={point.quadrant}
                data-column={slotKey(slot)}
                data-row={point.row}
                data-panel-anchor
                onClick={() => openPanel(point.task.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openPanel(point.task.id);
                  }
                }}
              >
                {/* 点击范围就是标签本身（文字加横线），不额外放大 */}
                <rect
                  className="node-hit"
                  x={label.left}
                  y={label.top}
                  width={label.width}
                  height={label.height}
                />
                {/* 标题写在细横线上；另一条细线连回自己的圆点 */}
                <line
                  className="node-line"
                  x1={label.left}
                  x2={label.left + label.width}
                  y1={label.top + label.height}
                  y2={label.top + label.height}
                />
                <line
                  className="node-leader"
                  x1={label.leader.x1}
                  y1={label.leader.y1}
                  x2={label.leader.x2}
                  y2={label.leader.y2}
                />
                <text
                  className="node-title"
                  x={label.left + TEXT_PAD}
                  y={label.top + label.height - TEXT_BASELINE}
                >
                  {title}
                </text>
              </g>
            );
          })}

          {/* 圆点永远在最上层 */}
          {drawn.map(({ point, slot, x, y }) => (
            <g
              key={point.task.id}
              className="matrix-dot"
              transform={`translate(${x} ${y})`}
              data-task-id={point.task.id}
              data-panel-anchor
              aria-hidden
              onClick={() => openPanel(point.task.id)}
            >
              <Marker colors={categoriesByTask(point.task.id).map((c) => c.color)} />
              {slot.kind === 'overdue' && <circle className="overdue-point-ring" r={RING_R} />}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
