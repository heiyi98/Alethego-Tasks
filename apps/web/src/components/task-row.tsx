'use client';

import {
  dateOfInstant,
  deriveTaskStatus,
  isSubtaskChecked,
  resolveRepresentativeInstance,
  seriesFromTask,
  subtasksFor,
  taskPermissions,
  type Category,
  type Task,
  type TaskStatus,
} from '@alethego/core';

import { useState } from 'react';

import { CategoryDot } from './category-dot';
import { useCurrentGroup } from './current-group';
import { usePanels } from './panel-provider';
import { StarButton } from './task-editor';
import { useTaskData } from './task-data-provider';
import { EditPanel } from './task-panels';
import { formatDeadline, importanceLabel, recurrenceLabel } from '@/lib/format';
import { PersonNames } from './person-name';
import { waitingOf } from '@/lib/schedule';

export function TaskRow({
  task,
  categories,
  now,
  timeZone,
  onToggleComplete,
  deadline = task.deadlineAt,
  status = task.recurrenceRule ? 'todo' : deriveTaskStatus(task, now),
}: {
  task: Task;
  categories: readonly Category[];
  now: Date;
  timeZone: string;
  /**
   * 勾选完成。普通任务：切换任务本身的完成状态；循环任务：完成当前这一次实例。
   * 不传时为只读行（不显示勾选框）。
   */
  onToggleComplete?: (task: Task) => void;
  /** 显示的截止时间；循环任务传代表实例的时间 */
  deadline?: Date | null;
  /** 列表状态；循环任务的状态不由任务本身的截止 / 完成时间决定 */
  status?: TaskStatus;
}) {
  const { active, open } = usePanels();
  const { data, toggleStar, toggleSubtask } = useTaskData();
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const { scopeOf } = useCurrentGroup();
  // 按任务所属的项目：开了任务分配时只有 R 能标记完成，R 或 A 能取消完成（含待确认）；
  // 没开时项目成员都能标记完成
  const scope = scopeOf(task.projectId);
  const project = scope?.project ?? data?.projects.find((p) => p.id === task.projectId) ?? null;
  const myRaci = scope
    ? (data?.assignmentsByTask.get(task.id) ?? [])
        .filter((a) => a.userId !== null && a.userId === scope.me?.userId)
        .map((a) => a.role)
    : [];
  const perms = taskPermissions(project, myRaci);
  const done = status === 'completed' || status === 'pending';

  // 子任务：挂在父任务下面，可以展开收起；父任务上显示进度。循环任务看当前代表的那一次
  const series = seriesFromTask(task);
  const occurrenceDate = series
    ? (resolveRepresentativeInstance(series, data?.occurrencesByTask.get(task.id) ?? [], {
        now,
        timeZone,
      })?.occurrenceAt ?? null)
    : null;
  const subtasks =
    series && !occurrenceDate
      ? []
      : subtasksFor(data?.subtasksByTask.get(task.id) ?? [], occurrenceDate);
  const checks = data?.subtaskChecks ?? [];
  const doneCount = subtasks.filter((s) => isSubtaskChecked(checks, s.id, occurrenceDate)).length;
  // 谁能勾：个人任务是自己；开了任务分配的项目里是执行人；没开的项目里是项目成员
  const canCheckSubtasks =
    task.groupId === null || (scope?.features.raci ? myRaci.includes('R') : true);
  const canToggle = done ? perms.uncomplete : perms.complete;
  // 列表中点击任务：标题所在的这一行留在原位并变为可编辑，面板从它下方展开；再次点击收起
  const expanded =
    active?.kind === 'edit' && active.taskId === task.id && active.surface === 'inline';
  const recurring = task.recurrenceRule !== null;
  const checkboxLabel = (completed: boolean) =>
    recurring ? `完成本次：${task.title}` : `${completed ? '取消完成' : '完成'}：${task.title}`;

  // 开了任务分配的项目里的简介行：时间、执行人、负责人
  const showRaci = Boolean(scope?.features.raci);
  const assignments = showRaci ? (data?.assignmentsByTask.get(task.id) ?? []) : [];
  const namesOf = (role: 'R' | 'A') =>
    assignments
      .filter((a) => a.role === role && a.userId)
      .map((a) => scope?.members.find((m) => m.userId === a.userId)?.nickname ?? '')
      .filter(Boolean);

  // 任务关系：还在等前置时，简介行最前面写"等待 某任务 开始 / 结束"，等多个时后面加剩余数量
  const waiting = data && !done ? waitingOf(task, data, dateOfInstant(now, timeZone)) : [];
  const firstWait = waiting[0];
  const waitingText = firstWait && (
    <span className="task-waiting">
      等待 {data?.tasks.find((t) => t.id === firstWait.predecessorId)?.title ?? ''}{' '}
      {firstWait.anchor === 'start' ? '开始' : '结束'}
      {waiting.length > 1 && ` +${waiting.length - 1}`}
    </span>
  );

  // 简介行一直存在、高度固定；没有内容时留空，每个任务行一样高
  const meta = showRaci ? (
    <span className="task-meta">
      {waitingText}
      {deadline && (
        <span className="task-deadline">
          {recurring && '本次 '}
          {formatDeadline(deadline, now, timeZone)}
        </span>
      )}
      {(['R', 'A'] as const).map(
        (role) =>
          namesOf(role).length > 0 && (
            <span key={role} className="task-raci" data-role={role}>
              <span className="task-raci-letter">{role}</span>
              <PersonNames names={namesOf(role)} />
            </span>
          ),
      )}
    </span>
  ) : (
    <span className="task-meta">
      {waitingText}
      {deadline && (
        <span className="task-deadline">
          {recurring && '本次 '}
          {formatDeadline(deadline, now, timeZone)}
        </span>
      )}
      {recurring && (
        <span className="task-recurrence">↻ {recurrenceLabel(task.recurrenceRule!, timeZone)}</span>
      )}
      {task.importanceLevel > 0 && (
        <span className="task-importance">{importanceLabel(task.importanceLevel)}</span>
      )}
      {categories.map((category) => (
        <span key={category.id} className="task-category">
          <CategoryDot color={category.color} />
          {category.name}
        </span>
      ))}
    </span>
  );

  if (expanded) {
    return (
      <li className={`task-item task-item-open task-${status}`} data-task-row={task.id}>
        <EditPanel
          taskId={task.id}
          surface="inline"
          focusTitle={active.focusTitle ?? false}
          row={{
            title: task.title,
            meta,
            checkbox: (form, onChange) =>
              onToggleComplete && (
                <input
                  type="checkbox"
                  className="task-check"
                  aria-label={checkboxLabel(form.completed)}
                  // 普通任务绑定面板里的完成状态（随自动保存写入）；循环任务完成当前这一次实例
                  checked={!recurring && form.completed}
                  disabled={(recurring && status === 'completed') || !canToggle}
                  onChange={() =>
                    recurring ? onToggleComplete(task) : onChange({ completed: !form.completed })
                  }
                />
              ),
          }}
        />
      </li>
    );
  }

  return (
    <li className={`task-item task-${status}`} data-task-row={task.id}>
      {/* 点任务名：展开并让标题进入编辑；点行内其他区域（勾选框和星标除外）：只展开 */}
      <div
        className="task-row"
        data-panel-anchor
        onClick={(event) => {
          const target = event.target as Element;
          if (target.closest('input, .row-actions')) return;
          open({
            kind: 'edit',
            taskId: task.id,
            surface: 'inline',
            focusTitle: Boolean(target.closest('.task-title')),
          });
        }}
      >
        {onToggleComplete && (
          <input
            type="checkbox"
            className="task-check"
            aria-label={checkboxLabel(done)}
            // 循环任务的勾选框永远代表"当前这一次"，勾选后代表实例顺延到下一次
            checked={!recurring && done}
            disabled={(recurring && status === 'completed') || !canToggle}
            onChange={() => onToggleComplete(task)}
          />
        )}
        <button type="button" className="task-main" aria-expanded={false} data-task-id={task.id}>
          <span className="task-title">{task.title}</span>
          {meta}
        </button>
        {subtasks.length > 0 && (
          <div className="row-actions">
            <button
              type="button"
              className="subtask-toggle"
              aria-label={`子任务 ${doneCount}/${subtasks.length}`}
              aria-expanded={subtasksOpen}
              onClick={() => setSubtasksOpen((v) => !v)}
            >
              {doneCount}/{subtasks.length}
            </button>
          </div>
        )}
        {/* 组任务不使用收藏 */}
        {task.groupId === null && (
          <div className="row-actions">
            <StarButton starred={task.isStarred} onToggle={() => void toggleStar(task)} />
          </div>
        )}
      </div>
      {subtasksOpen && subtasks.length > 0 && (
        <ul className="subtask-list" aria-label={`「${task.title}」的子任务`}>
          {subtasks.map((subtask) => {
            const checked = isSubtaskChecked(checks, subtask.id, occurrenceDate);
            return (
              <li key={subtask.id} className={`subtask-row${checked ? ' subtask-done' : ''}`}>
                <input
                  type="checkbox"
                  className="task-check"
                  aria-label={`完成子任务：${subtask.title}`}
                  checked={checked}
                  disabled={!canCheckSubtasks}
                  onChange={(event) =>
                    void toggleSubtask(subtask, occurrenceDate, event.target.checked)
                  }
                />
                <span className="subtask-title">{subtask.title}</span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
