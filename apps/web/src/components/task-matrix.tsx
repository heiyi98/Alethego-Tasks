'use client';

import {
  MATRIX_ROWS,
  MATRIX_TIER_COLUMNS,
  OVERDUE_COLUMN,
  type Category,
  type MatrixPoint,
} from '@alethego/core';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

import { CategoryDot } from './category-dot';
import { QUADRANT_LABELS, TIER_TICK_LABELS, formatDeadline, importanceLabel } from '@/lib/format';

/**
 * 时间管理矩阵：X = 紧迫度（越靠右越紧急），Y = 重要性（越靠上越重要）。
 * 不画格子网格线，只画区分四个象限的两条细线；点在格内由 core 的布局算法散布避让。
 */

const VIEW_W = 720;
const VIEW_H = 440;
const M = { top: 30, right: 12, bottom: 44, left: 76 };
const PLOT_W = VIEW_W - M.left - M.right;
const PLOT_H = VIEW_H - M.top - M.bottom;
/** 逾期贴边列比普通档位宽，放得下"逾期 N 天"标注 */
const OVERDUE_WEIGHT = 1.6;
const OVERDUE_GAP = 6;
const TIER_W = (PLOT_W - OVERDUE_GAP) / (MATRIX_TIER_COLUMNS + OVERDUE_WEIGHT);
const ROW_H = PLOT_H / MATRIX_ROWS;
/** 紧急区从第 6 档（两周内）开始 = 第 7 列 */
const FIRST_URGENT_COLUMN = MATRIX_TIER_COLUMNS - 7;
/** 重要区从重要性 3 开始 */
const FIRST_IMPORTANT_ROW = 3;

const DOT_R = 7;
const HIT_R = 14;

const colX = (column: number) =>
  column === OVERDUE_COLUMN
    ? M.left + MATRIX_TIER_COLUMNS * TIER_W + OVERDUE_GAP
    : M.left + column * TIER_W;
const colW = (column: number) => (column === OVERDUE_COLUMN ? TIER_W * OVERDUE_WEIGHT : TIER_W);
const rowTop = (row: number) => M.top + (MATRIX_ROWS - 1 - row) * ROW_H;
const PLOT_RIGHT = colX(OVERDUE_COLUMN) + colW(OVERDUE_COLUMN);

function pointPosition(point: MatrixPoint) {
  return {
    x: colX(point.column) + point.offsetX * colW(point.column),
    y: rowTop(point.row) + (1 - point.offsetY) * ROW_H,
  };
}

/** 多分类任务的圆点按分类切片（小饼图） */
function DotBody({ colors }: { colors: readonly string[] }) {
  if (colors.length <= 1) {
    return <circle r={DOT_R} className="dot-fill" style={{ fill: colors[0] }} />;
  }
  const step = (Math.PI * 2) / colors.length;
  return (
    <>
      {colors.map((color, i) => {
        const a0 = -Math.PI / 2 + i * step;
        const a1 = a0 + step;
        const d = [
          'M 0 0',
          `L ${DOT_R * Math.cos(a0)} ${DOT_R * Math.sin(a0)}`,
          `A ${DOT_R} ${DOT_R} 0 ${step > Math.PI ? 1 : 0} 1 ${DOT_R * Math.cos(a1)} ${DOT_R * Math.sin(a1)}`,
          'Z',
        ].join(' ');
        return <path key={i} d={d} className="dot-slice" style={{ fill: color }} />;
      })}
    </>
  );
}

function describeDeadline(point: MatrixPoint, now: Date, timeZone: string): string {
  if (point.urgency.kind === 'overdue') {
    return point.overdueDays === 0 ? '今天已逾期' : `逾期 ${point.overdueDays} 天`;
  }
  const shown = point.representative.occurrenceAt ?? point.task.deadlineAt;
  if (!shown) return '无截止时间';
  const text = formatDeadline(shown, now, timeZone);
  return point.representative.occurrenceAt ? `本次 ${text}` : text;
}

interface Tooltip {
  point: MatrixPoint;
  left: number;
  top: number;
  /** 靠近顶部时显示在圆点下方，避免被裁切 */
  below: boolean;
}

/** 提示框大致高度；圆点上方空间不足时改为显示在下方 */
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
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  // 窄屏下矩阵可横向滚动：初始滚到最右侧，先看到紧急区
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, []);

  function showTooltip(point: MatrixPoint, event: PointerEvent<Element> | FocusEvent<Element>) {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const box = event.currentTarget.getBoundingClientRect();
    const origin = wrapper.getBoundingClientRect();
    const below = box.top - origin.top < TOOLTIP_SPACE;
    setTooltip({
      point,
      left: box.left + box.width / 2 - origin.left,
      top: below ? box.bottom - origin.top : box.top - origin.top,
      below,
    });
  }
  const hideTooltip = () => setTooltip(null);

  const urgentX = colX(FIRST_URGENT_COLUMN);
  const importantY = rowTop(FIRST_IMPORTANT_ROW - 1);

  return (
    <div className="matrix-wrapper" ref={wrapperRef}>
      <div className="matrix-scroll" ref={scrollRef} onScroll={hideTooltip}>
        <svg
          className="matrix"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={`时间管理矩阵，共 ${points.length} 个任务`}
        >
          {/* 逾期贴边列 */}
          <rect
            className="matrix-overdue-strip"
            x={colX(OVERDUE_COLUMN)}
            y={M.top}
            width={colW(OVERDUE_COLUMN)}
            height={PLOT_H}
            rx={4}
          />

          {/* 象限分界（不画格子网格线） */}
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
          <line
            className="matrix-axis"
            x1={M.left}
            x2={PLOT_RIGHT}
            y1={M.top + PLOT_H}
            y2={M.top + PLOT_H}
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
            transform={`translate(14 ${(M.top + importantY) / 2}) rotate(-90)`}
          >
            重要
          </text>
          <text
            className="matrix-region"
            transform={`translate(14 ${(importantY + M.top + PLOT_H) / 2}) rotate(-90)`}
          >
            不重要
          </text>

          {/* 刻度 */}
          {Array.from({ length: MATRIX_ROWS }, (_, row) => (
            <text
              key={row}
              className="matrix-tick"
              x={M.left - 8}
              y={rowTop(row) + ROW_H / 2}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {row === 0 ? '未设置' : row}
            </text>
          ))}
          {[...TIER_TICK_LABELS, '逾期'].map((label, column) => (
            <text
              key={column}
              className="matrix-tick"
              x={colX(column) + colW(column) / 2}
              y={M.top + PLOT_H + 16}
              textAnchor="middle"
            >
              {label}
            </text>
          ))}
          <text className="matrix-axis-title" x={(M.left + PLOT_RIGHT) / 2} y={VIEW_H - 6}>
            截止时间（越靠右越紧急）
          </text>

          {/* 任务点 */}
          {points.map((point) => {
            const { x, y } = pointPosition(point);
            const categories = categoriesByTask(point.task.id);
            const colors = categories.map((c) => c.color);
            const href = `/tasks/${point.task.id}`;
            const label = [
              point.task.title,
              describeDeadline(point, now, timeZone),
              `重要性 ${importanceLabel(point.task.importanceLevel)}`,
              QUADRANT_LABELS[point.quadrant],
            ].join('，');
            return (
              <a
                key={point.task.id}
                href={href}
                className="matrix-dot"
                aria-label={label}
                data-task-id={point.task.id}
                data-quadrant={point.quadrant}
                data-column={point.column}
                data-row={point.row}
                onClick={(event) => {
                  event.preventDefault();
                  router.push(href);
                }}
                onPointerEnter={(event) => showTooltip(point, event)}
                onPointerLeave={hideTooltip}
                onFocus={(event) => showTooltip(point, event)}
                onBlur={hideTooltip}
              >
                <g transform={`translate(${x} ${y})`}>
                  <circle r={HIT_R} className="dot-hit" />
                  {point.overdueDays !== null && (
                    <circle r={DOT_R + 3.5} className="dot-overdue-ring" />
                  )}
                  {colors.length === 0 ? (
                    <circle r={DOT_R} className="dot-fill dot-uncategorized" />
                  ) : (
                    <DotBody colors={colors} />
                  )}
                  <circle r={DOT_R} className="dot-ring" />
                  {point.overdueDays !== null && (
                    <text className="dot-overdue-label" y={DOT_R + 16} textAnchor="middle">
                      {point.overdueDays === 0 ? '今天逾期' : `逾期${point.overdueDays}天`}
                    </text>
                  )}
                </g>
              </a>
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
            重要性 {importanceLabel(tooltip.point.task.importanceLevel)} ·{' '}
            {QUADRANT_LABELS[tooltip.point.quadrant]}
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
