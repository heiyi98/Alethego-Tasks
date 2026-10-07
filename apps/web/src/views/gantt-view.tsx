'use client';

import { dateOfInstant, type Task } from '@alethego/core';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useCurrentGroup } from '@/components/current-group';
import { PersonNames } from '@/components/person-name';
import { useSelection } from '@/components/selection';
import { useTaskData } from '@/components/task-data-provider';
import { ViewFrame } from '@/components/view-frame';
import { useVisibleTasks } from '@/hooks/use-visible-tasks';
import {
  DAY_EM,
  buildGantt,
  dayLineX,
  dayLines,
  ganttTicks,
  ganttWidth,
  type GanttRow,
  type GanttScale,
} from '@/lib/gantt-layout';
import { selectionHref } from '@/lib/selection';
import { canvasMeasure, estimateMeasure } from '@/lib/text-measure';

/**
 * 甘特图（开了任务关系的项目；个人只选中一个开了任务关系的分类时）：
 * 时间轴从左到右是过去到将来，每一天是一条竖线，刻度可在日、周、月之间切换（两天之间的距离按字号算），
 * "今天"就是今天那条线，可以左右滑动。
 * 一个任务一行，按开始日期排序；任务条从开始那天的线到结束那天的线，同一天结束和开始的任务在同一条线上；
 * 开始和结束同一天、只有开始或只有结束的任务是那天线上的菱形。
 * 任务名写在条里（条太短写在条右边）；条按未完成、待确认、已完成区分；
 * 浮动时间是条后面一段淡色的延长，关键路径醒目标出；关系画成箭头，从前置指向后续。
 * 只能看：点任务条切回清单，把这条任务滚动到屏幕中间并原地展开。
 */
export function GanttView() {
  return (
    <ViewFrame>
      <GanttChart />
    </ViewFrame>
  );
}

const ROW_H = 34;
const BAR_H = 20;
const HEADER_H = 44;
const LABEL_FONT = '13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';

const SCALES: readonly [GanttScale, string][] = [
  ['day', '日'],
  ['week', '周'],
  ['month', '月'],
];

function GanttChart() {
  const { data, now, timeZone } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  const { project, scopeOf } = useCurrentGroup();
  const visible = useVisibleTasks();
  const [scale, setScale] = useState<GanttScale>('day');
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = dateOfInstant(now, timeZone);
  // 1em 是多少像素（天与天的距离按 em 定，画线和箭头时换成像素）
  const [emPx, setEmPx] = useState(16);
  useLayoutEffect(() => {
    const measureEm = () => {
      const el = scrollRef.current;
      if (el) setEmPx(parseFloat(getComputedStyle(el).fontSize) || 16);
    };
    measureEm();
    window.addEventListener('resize', measureEm);
    return () => window.removeEventListener('resize', measureEm);
  }, []);
  const dayWidth = DAY_EM[scale] * emPx;

  const layout = useMemo(() => {
    if (!data) return null;
    const categoryId = selection.categoryIds[0];
    const inScope = (t: Task) =>
      !t.deletedAt &&
      !t.recurrenceRule &&
      (project
        ? t.projectId === project.id
        : t.groupId === null && (data.categoryIdsByTask.get(t.id) ?? []).includes(categoryId!));
    return buildGantt({
      tasks: visible.filter(inScope),
      scopeTasks: data.tasks.filter(inScope),
      relationsByTask: data.relationsByTask,
      timeZone,
      today,
    });
  }, [data, visible, project, selection.categoryIds, timeZone, today]);

  // 一打开就把"今天"放在左边附近
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !layout) return;
    el.scrollLeft = Math.max(0, dayLineX(today, layout.from, dayWidth) - 3.5 * dayWidth);
    // 只在换刻度、换范围时滚动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, layout?.from, emPx]);

  const measure = useMemo(() => canvasMeasure(LABEL_FONT) ?? estimateMeasure(13), []);

  if (!data || !layout) return null;
  const x = (date: string) => dayLineX(date, layout.from, dayWidth);
  const width = ganttWidth(layout.from, layout.to, dayWidth);
  const height = layout.rows.length * ROW_H;
  const ticks = ganttTicks(layout.from, layout.to, scale);
  const lines = dayLines(layout.from, layout.to);
  const rowIndex = new Map(layout.rows.map((r, i) => [r.task.id, i]));
  const xStart = (r: GanttRow) => x(r.start);
  const xEnd = (r: GanttRow) => x(r.end);
  const todayX = x(today);

  // 开了任务分配的项目：任务名后面加上执行人
  const assigneesOf = (task: Task) => {
    const scope = scopeOf(task.projectId);
    if (!scope?.features.raci) return [];
    return (data.assignmentsByTask.get(task.id) ?? [])
      .filter((a) => a.role === 'R' && a.userId)
      .map((a) => scope.members.find((m) => m.userId === a.userId)?.nickname ?? '')
      .filter(Boolean);
  };

  // 点任务条：切回清单，原地展开这条任务（和通知里的"查看"一样）
  const openInList = (taskId: string) => {
    const href = selectionHref({ ...selection, mode: 'list' });
    router.replace(`${href}${href.includes('?') ? '&' : '?'}task=${taskId}`, { scroll: false });
  };

  const anchorX = (r: GanttRow, at: 'start' | 'end') => (at === 'start' ? xStart(r) : xEnd(r));

  return (
    <div className="gantt">
      <div className="mini-segmented gantt-scale" role="radiogroup" aria-label="刻度">
        {SCALES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={scale === key}
            aria-pressed={scale === key}
            onClick={() => setScale(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="gantt-scroll"
        ref={scrollRef}
        data-testid="gantt-scroll"
        data-day-width={dayWidth}
      >
        <div className="gantt-canvas" style={{ width, height: HEADER_H + height }}>
          <div className="gantt-header" style={{ width }}>
            {ticks.major.map((t) => (
              <span key={`M${t.date}`} className="gantt-tick-major" style={{ left: x(t.date) }}>
                {t.label}
              </span>
            ))}
            {ticks.minor.map((t) => (
              <span key={`m${t.date}`} className="gantt-tick-minor" style={{ left: x(t.date) }}>
                {t.label}
              </span>
            ))}
          </div>
          <div className="gantt-body" style={{ top: HEADER_H, width, height }}>
            {lines.map((line) => (
              <span
                key={`g${line.date}`}
                className={`gantt-grid gantt-grid-${line.kind}`}
                data-date={line.date}
                style={{ left: x(line.date) }}
              />
            ))}
            <span
              className="gantt-today"
              data-testid="gantt-today"
              data-date={today}
              style={{ left: todayX }}
            />
            <svg className="gantt-links" width={width} height={height} aria-hidden>
              <defs>
                <marker
                  id="gantt-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" className="gantt-arrow-head" />
                </marker>
                <marker
                  id="gantt-arrow-critical"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" className="gantt-arrow-head-critical" />
                </marker>
              </defs>
              {layout.links.map((link) => {
                const from = layout.rows[rowIndex.get(link.from)!]!;
                const to = layout.rows[rowIndex.get(link.to)!]!;
                const fy = rowIndex.get(link.from)! * ROW_H + ROW_H / 2;
                const ty = rowIndex.get(link.to)! * ROW_H + ROW_H / 2;
                const fx = anchorX(from, link.anchor);
                const tx = anchorX(to, link.side);
                const out = fx + 6;
                const d =
                  tx - 6 >= out
                    ? `M${fx},${fy} H${out} V${ty} H${tx}`
                    : `M${fx},${fy} H${out} V${(fy + ty) / 2} H${tx - 6} V${ty} H${tx}`;
                return (
                  <path
                    key={`${link.from}-${link.anchor}-${link.to}-${link.side}`}
                    d={d}
                    className={`gantt-link${link.critical ? ' gantt-link-critical' : ''}`}
                    data-from={link.from}
                    data-to={link.to}
                    markerEnd={`url(#${link.critical ? 'gantt-arrow-critical' : 'gantt-arrow'})`}
                  />
                );
              })}
            </svg>
            {layout.rows.map((row, i) => {
              const names = assigneesOf(row.task);
              const assignees = names.length > 0 && (
                <span className="gantt-assignees">
                  <PersonNames names={names} />
                </span>
              );
              // 名字格子每个 4 个字宽（13px 的字），格子之间留 0.25 字
              const labelWidth =
                measure.width(row.task.title) +
                (names.length > 0 ? 13 / 2 : 0) +
                names.length * (4 * 13 + 13 / 4);
              const top = i * ROW_H + (ROW_H - BAR_H) / 2;
              const classes = `gantt-bar gantt-${row.status}${row.critical ? ' gantt-critical' : ''}`;
              if (row.milestone) {
                const mx = xEnd(row);
                return (
                  <div key={row.task.id} className="gantt-row" data-task-id={row.task.id}>
                    {row.float > 0 && (
                      <span
                        className="gantt-float"
                        style={{
                          left: mx,
                          top: top + 4,
                          width: row.float * dayWidth,
                          height: BAR_H - 8,
                        }}
                      />
                    )}
                    <button
                      type="button"
                      className={`${classes} gantt-milestone`}
                      aria-label={row.task.title}
                      data-milestone
                      data-x={mx}
                      style={{ left: mx - BAR_H / 2, top, width: BAR_H, height: BAR_H }}
                      onClick={() => openInList(row.task.id)}
                    />
                    <span
                      className="gantt-label gantt-label-outside"
                      style={{ left: mx + BAR_H / 2 + 4, top }}
                    >
                      {row.task.title}
                      {assignees}
                    </span>
                  </div>
                );
              }
              const left = xStart(row);
              const barWidth = xEnd(row) - left;
              const inside = labelWidth + 12 <= barWidth;
              return (
                <div key={row.task.id} className="gantt-row" data-task-id={row.task.id}>
                  {row.float > 0 && (
                    <span
                      className="gantt-float"
                      style={{
                        left: left + barWidth,
                        top,
                        width: row.float * dayWidth,
                        height: BAR_H,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className={classes}
                    aria-label={row.task.title}
                    data-x={left}
                    data-x-end={left + barWidth}
                    style={{ left, top, width: barWidth, height: BAR_H }}
                    onClick={() => openInList(row.task.id)}
                  >
                    {inside && (
                      <span className="gantt-label gantt-label-inside">
                        {row.task.title}
                        {assignees}
                      </span>
                    )}
                  </button>
                  {!inside && (
                    <span
                      className="gantt-label gantt-label-outside"
                      style={{ left: left + barWidth + 4, top }}
                    >
                      {row.task.title}
                      {assignees}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {layout.unscheduled.length > 0 && (
        <section className="gantt-unscheduled" aria-label="未排期">
          <h2>未排期</h2>
          <ul>
            {layout.unscheduled.map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => openInList(task.id)}>
                  {task.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
