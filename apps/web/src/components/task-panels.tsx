'use client';

import {
  featuresForProject,
  normalizeLocationDraft,
  normalizePeopleDrafts,
  resolveRepresentativeInstance,
  seriesFromTask,
  subtaskProgress,
  subtasksFor,
  taskPermissions,
  type Category,
  type RecurrenceOccurrence,
  type Task,
} from '@alethego/core';
import { loadTaskDetail, saveTaskExtensions, syncOccurrences } from '@alethego/data';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useCurrentGroup } from './current-group';
import { useFeedback } from './feedback-provider';
import { CheckCircleIcon, CheckIcon, IconButton, TrashIcon } from './icons';
import { PanelSurface } from './panel-surface';
import { usePanels } from './panel-provider';
import { useRepositories } from './repositories-provider';
import { useSelection } from './selection';
import { EditorTitleRow, StarButton, TaskEditor } from './task-editor';
import { useTaskData } from './task-data-provider';
import { isSaveEnter, useUnsaved, useUnsavedChanges } from './unsaved-changes';
import { errorMessage, toDateValue } from '@/lib/format';
import { previewDates, relationScopes, scheduleEligible, scopeIdOf } from '@/lib/schedule';
import {
  locationDraft,
  newTaskFromForm,
  peopleDrafts,
  peopleRows,
  sameLocation,
  samePeople,
  sameRaci,
  sameSchedule,
  sameSubtasks,
  subtaskDrafts,
  subtaskRows,
  scheduleFormFrom,
  scheduleInputFrom,
  taskFormFromDetail,
  taskPatchFromForms,
  validateTaskForm,
  type FormErrors,
  type PersonRow,
  type TaskFormValue,
} from '@/lib/task-form';

/* ------------------------------------------------------------------ */
/* 新建                                                                 */
/* ------------------------------------------------------------------ */

/** 新建：把草稿写入数据库（任务 + 分类 + 地点 / 人物）；container 不为空时是这个项目的任务（不带分类） */
export function useCreateTask(container: { groupId: string; projectId: string } | null = null) {
  const repositories = useRepositories();
  const { reload, timeZone } = useTaskData();
  return useCallback(
    async (form: TaskFormValue): Promise<{ created: boolean; message?: string }> => {
      try {
        // 开了任务分配的项目：任务、RACI、地点、人物一起写入（数据库要求必须有执行人和负责人）
        const withRaci = container !== null && form.raci.length > 0;
        const people = normalizePeopleDrafts(form.people);
        const input = newTaskFromForm(form, timeZone, container);
        const subtasks = subtaskDrafts(form.subtasks).map((s) => s.title);
        const task = await repositories.tasks.create(
          withRaci
            ? {
                ...input,
                assignments: form.raci,
                location: normalizeLocationDraft(form.location),
                people: people.ok ? people.people : [],
                subtasks,
              }
            : input,
        );
        if (withRaci) return { created: true };
        try {
          if (subtasks.length > 0) {
            await repositories.subtasks.setList(
              task.id,
              subtasks.map((title) => ({ title })),
            );
          }
          if (!container && form.categoryIds.length > 0) {
            await repositories.categories.setTaskCategories(task.id, form.categoryIds);
          }
          const location = normalizeLocationDraft(form.location);
          const people = normalizePeopleDrafts(form.people);
          if (location || (people.ok && people.people.length > 0)) {
            await saveTaskExtensions(repositories, task.id, {
              location,
              people: people.ok ? people.people : [],
            });
          }
        } catch (e) {
          return { created: true, message: `任务已创建，但部分信息未保存：${errorMessage(e)}` };
        }
        return { created: true };
      } catch (e) {
        return { created: false, message: `创建失败：${errorMessage(e)}` };
      } finally {
        await reload();
      }
    },
    [repositories, reload, timeZone, container],
  );
}

/* ------------------------------------------------------------------ */
/* 编辑（点 ✓ 保存）                                                    */
/* ------------------------------------------------------------------ */

/** dirty：有没保存的改动；invalid：点了 ✓ 但有不合法的字段，没有保存 */
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'invalid' | 'error';

interface Loaded {
  task: Task;
  records: RecurrenceOccurrence[];
}

/**
 * 编辑已有任务：与新建共用 TaskEditor。改动只在点 ✓（或单行输入框里按回车）时保存，保存后收起；
 * 有没保存的改动时，点别处、切换页面等由 UnsavedChangesProvider 先确认（放弃修改 / 继续编辑）。
 */
/** 列表中展开时，任务行本身（留在原位、标题变为可编辑）由 TaskRow 提供的部件组成 */
export interface EditRowParts {
  /** 加载完成前显示的标题 */
  title: string;
  /** 行首的勾选框；普通任务绑定到面板的完成状态，循环任务完成当前实例 */
  checkbox: (form: TaskFormValue, onChange: (patch: Partial<TaskFormValue>) => void) => ReactNode;
  /** 标题下方的截止时间、分类等 */
  meta: ReactNode;
}

export function EditPanel({
  taskId,
  surface,
  row,
  focusTitle = false,
}: {
  taskId: string;
  surface: 'inline' | 'floating';
  row?: EditRowParts;
  /** 点任务名展开时：标题直接进入编辑状态（光标聚焦） */
  focusTitle?: boolean;
}) {
  const repositories = useRepositories();
  const { data, now, timeZone, reload, toggleSubtask } = useTaskData();
  const { close } = usePanels();
  const { showUndo } = useFeedback();
  const { scopeOf } = useCurrentGroup();
  const selection = useSelection();
  const dataRef = useRef(data);
  dataRef.current = data;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<TaskFormValue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // 保存相关的状态放在 ref 里，卸载时的 flush 也能拿到最新值
  const formRef = useRef<TaskFormValue | null>(null);
  const savedRef = useRef<TaskFormValue | null>(null);
  const taskRef = useRef<Task | null>(null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const rootRef = useRef<HTMLDivElement>(null);
  const { guard } = useUnsaved();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await loadTaskDetail(repositories, taskId);
        if (cancelled) return;
        if (!detail) {
          setLoadError('任务不存在或已删除。');
          return;
        }
        // RACI、关系、子任务从数据库重新读（刚保存过时清单的数据可能还没刷新）
        const [records, assignments, relations, subtasks] = await Promise.all([
          syncOccurrences(repositories.occurrences, detail.task, { now: new Date(), timeZone }),
          detail.task.projectId
            ? repositories.assignments.listForTasks([taskId])
            : Promise.resolve([]),
          repositories.relations.listForTasks([taskId]),
          repositories.subtasks.listForTasks([taskId]),
        ]);
        if (cancelled) return;
        const raci = assignments.map((a) => ({
          role: a.role,
          userId: a.userId,
          contactId: a.contactId,
        }));
        const current = dataRef.current;
        const schedule = scheduleFormFrom(
          detail.task,
          relations.filter((r) => r.taskId === taskId),
          (predecessorId) => (current ? scopeIdOf(predecessorId, current) : ''),
        );
        const initial = taskFormFromDetail(
          detail,
          timeZone,
          raci,
          schedule,
          subtasksFor(subtasks.subtasks, null),
        );
        formRef.current = initial;
        savedRef.current = initial;
        taskRef.current = detail.task;
        setLoaded({ task: detail.task, records });
        setForm(initial);
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repositories, taskId, timeZone]);

  /** 当前表单与上次保存的差异 */
  const changesOf = useCallback(
    (current: TaskFormValue, saved: TaskFormValue, task: Task) => {
      const patch = taskPatchFromForms(current, saved, timeZone);
      const categoriesChanged =
        [...current.categoryIds].sort().join() !== [...saved.categoryIds].sort().join();
      const people = normalizePeopleDrafts(current.people);
      const extensionsChanged =
        !sameLocation(current.location, saved.location) ||
        !samePeople(current.people, saved.people);
      const raciChanged = !sameRaci(current.raci, saved.raci);
      const subtasksChanged = !sameSubtasks(current.subtasks, saved.subtasks);
      // 两行逻辑：只在有"任务关系"、不是循环任务时保存；刚改成循环任务时先去掉它自己的关系
      const eligible = scheduleEligible(task, current, dataRef.current);
      const scheduleChanged =
        eligible &&
        !current.recurrence.enabled &&
        !sameSchedule(current.schedule, saved.schedule, timeZone);
      const clearSchedule =
        current.recurrence.enabled &&
        !saved.recurrence.enabled &&
        saved.schedule !== null &&
        (saved.schedule.startRelations.length > 0 || saved.schedule.endRelations.length > 0);
      const any =
        Object.keys(patch).length > 0 ||
        categoriesChanged ||
        raciChanged ||
        subtasksChanged ||
        scheduleChanged ||
        clearSchedule ||
        extensionsChanged;
      return {
        patch,
        categoriesChanged,
        people,
        extensionsChanged,
        raciChanged,
        subtasksChanged,
        scheduleChanged,
        clearSchedule,
        any,
      };
    },
    [timeZone],
  );

  const isDirty = () => {
    const current = formRef.current;
    const saved = savedRef.current;
    const task = taskRef.current;
    if (!current || !saved || !task) return false;
    // 改成了不合法的值（例如清空标题）也算没保存的改动
    return changesOf(current, saved, task).any || Object.keys(validateTaskForm(current)).length > 0;
  };

  /** 把当前表单与上次保存的差异写入数据库；有不合法的字段时不保存。返回是否已全部保存 */
  const saveNow = useCallback((): Promise<boolean> => {
    chain.current = chain.current.then(async () => {
      const current = formRef.current;
      const saved = savedRef.current;
      const task = taskRef.current;
      if (!current || !saved || !task) return true;
      if (Object.keys(validateTaskForm(current)).length > 0) {
        setSaveState('invalid');
        return false;
      }
      const {
        patch,
        categoriesChanged,
        people,
        extensionsChanged,
        raciChanged,
        subtasksChanged,
        scheduleChanged,
        clearSchedule,
        any,
      } = changesOf(current, saved, task);
      if (!any) {
        setSaveState('saved');
        return true;
      }

      setSaveState('saving');
      try {
        let nextTask = task;
        // 先存分类（决定个人任务有没有"任务关系"），再存两行逻辑，最后存内容
        // （结束改回固定日期时，要先去掉结束的关系，截止时间才不会被算出来的值覆盖）
        if (categoriesChanged) {
          await repositories.categories.setTaskCategories(task.id, current.categoryIds);
        }
        let deadlineFromServer: Pick<TaskFormValue, 'deadline' | 'deadlineTime'> | null = null;
        if ((scheduleChanged || clearSchedule) && current.schedule) {
          const input = clearSchedule
            ? {
                startOn: null,
                startRelations: [],
                endAfterDays: null,
                endRelations: [],
                dateZone: timeZone,
              }
            : scheduleInputFrom(current.schedule, timeZone);
          nextTask = await repositories.relations.setSchedule(task.id, input);
          if (!clearSchedule && current.schedule.endMode !== 'date') {
            // 结束是算出来的：表单里的截止日期跟着服务器的值走
            deadlineFromServer = {
              deadline: nextTask.deadlineAt ? toDateValue(nextTask.deadlineAt) : '',
              deadlineTime: '',
            };
          }
        }
        if (Object.keys(patch).length > 0)
          nextTask = await repositories.tasks.update(task.id, patch);
        if (raciChanged) await repositories.assignments.set(task.id, current.raci);
        let savedSubtasks = saved.subtasks;
        if (subtasksChanged) {
          savedSubtasks = subtaskRows(
            await repositories.subtasks.setList(task.id, subtaskDrafts(current.subtasks)),
          );
          formRef.current = { ...formRef.current!, subtasks: savedSubtasks };
          setForm((f) => (f ? { ...f, subtasks: savedSubtasks } : f));
        }
        let savedPeople: PersonRow[] = saved.people;
        let savedLocation = saved.location;
        if (extensionsChanged && people.ok) {
          const result = await saveTaskExtensions(repositories, task.id, {
            location: current.location,
            people: peopleDrafts(current.people),
          });
          savedLocation = locationDraft(result.location);
          savedPeople = peopleRows(result.people);
          // 新增的人物拿到 id 后回填到表单行上，之后的修改走更新而不是重复新增
          const knownIds = new Set(current.people.flatMap((p) => (p.id ? [p.id] : [])));
          const created = result.people.filter((p) => !knownIds.has(p.id));
          const newRows = current.people.filter((p) => !p.id && p.name.trim());
          const idByKey = new Map(newRows.map((row, i) => [row.key, created[i]?.id]));
          const withIds = (rows: PersonRow[]) =>
            rows.map((row) => (idByKey.get(row.key) ? { ...row, id: idByKey.get(row.key) } : row));
          formRef.current = { ...formRef.current!, people: withIds(formRef.current!.people) };
          setForm((f) => (f ? { ...f, people: withIds(f.people) } : f));
        }

        if (deadlineFromServer) {
          const synced = deadlineFromServer;
          formRef.current = { ...formRef.current!, ...synced };
          setForm((f) => (f ? { ...f, ...synced } : f));
        }
        // 已保存的快照：本次实际写入的字段取当前值，其余沿用上次
        savedRef.current = {
          ...saved,
          schedule: scheduleChanged || clearSchedule ? current.schedule : saved.schedule,
          title: patch.title !== undefined ? current.title : saved.title,
          description: current.description,
          deadline:
            deadlineFromServer?.deadline ??
            (current.recurrence.enabled ? saved.deadline : current.deadline),
          deadlineTime:
            deadlineFromServer?.deadlineTime ??
            (current.recurrence.enabled ? saved.deadlineTime : current.deadlineTime),
          isStarred: current.isStarred,
          importanceLevel: current.importanceLevel,
          completed: current.recurrence.enabled ? saved.completed : current.completed,
          recurrence: patch.recurrenceRule !== undefined ? current.recurrence : saved.recurrence,
          categoryIds: current.categoryIds,
          raci: current.raci,
          subtasks: savedSubtasks,
          location: extensionsChanged && people.ok ? savedLocation : saved.location,
          people: extensionsChanged && people.ok ? savedPeople : saved.people,
        };
        taskRef.current = nextTask;

        // 清空描述是不可逆动作：保存后提供撤销
        if (saved.description.trim() && !current.description.trim()) {
          const previous = saved.description;
          showUndo('已清空描述', () => {
            formRef.current = { ...formRef.current!, description: previous };
            setForm((f) => (f ? { ...f, description: previous } : f));
            void saveNowRef.current();
          });
        }

        if (patch.recurrenceRule !== undefined || patch.recurrenceDtstart !== undefined) {
          // 开始时间改了：从新的开始时间补齐缺的记录（已有记录不动）；只改规则时新规则只管以后到点的实例
          const startChanged =
            nextTask.recurrenceDtstart !== null &&
            nextTask.recurrenceDtstart.getTime() !== task.recurrenceDtstart?.getTime();
          const records = await syncOccurrences(
            repositories.occurrences,
            nextTask,
            { now: new Date(), timeZone },
            startChanged ? { backfillFrom: nextTask.recurrenceDtstart! } : {},
          );
          setLoaded((l) => (l ? { task: nextTask, records } : l));
        } else {
          setLoaded((l) => (l ? { ...l, task: nextTask } : l));
        }
        setSaveState('saved');
        setSaveError(null);
        void reload();
        return true;
      } catch (e) {
        setSaveState('error');
        setSaveError(errorMessage(e));
        return false;
      }
    });
    return chain.current;
  }, [repositories, timeZone, reload, showUndo, changesOf]);

  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  /** 放弃没保存的改动：表单回到上次保存的样子 */
  function discardChanges() {
    if (!savedRef.current) return;
    formRef.current = savedRef.current;
    setForm(savedRef.current);
    setSaveState('idle');
  }

  useUnsavedChanges(rootRef, isDirty, () => {
    discardChanges();
    close();
  });

  /** ✓：保存并收起；保存不成功（不合法、出错）时留在面板里 */
  async function saveAndClose() {
    if (await saveNowRef.current()) close();
  }

  /** 点别处、Esc、下滑等收起：有改动时先确认 */
  const requestClose = () => void guard(close);

  function onChange(patch: Partial<TaskFormValue>) {
    if (!formRef.current) return;
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    setSaveState('dirty');
  }

  function removePerson(index: number) {
    const current = formRef.current;
    const removed = current?.people[index];
    if (!current || !removed) return;
    onChange({ people: current.people.filter((_, i) => i !== index) });
    if (removed.name.trim() || removed.relation.trim()) {
      // 撤销：按原值重新添加（作为新记录保存）
      showUndo(`已删除人物「${removed.name || removed.relation}」`, () => {
        const people = [...(formRef.current?.people ?? [])];
        people.splice(Math.min(index, people.length), 0, { ...removed, id: undefined });
        onChange({ people });
      });
    }
  }

  async function deleteTask() {
    const task = taskRef.current;
    if (!task) return;
    // 删除时没保存的改动一并放弃；撤销删除恢复的是上次保存的内容
    await repositories.tasks.delete(task.id);
    discardChanges();
    close();
    await reload();
    showUndo(`已删除「${task.title}」`, async () => {
      await repositories.tasks.restore(task.id);
      await reload();
    });
  }

  const wrap = (header: ReactNode, body: ReactNode) => (
    <div
      className={`edit-panel edit-panel-${surface}`}
      role="form"
      aria-label="编辑任务"
      data-task-id={taskId}
      data-save-state={saveState}
      onKeyDown={(event) => {
        if (!isSaveEnter(event)) return;
        event.preventDefault();
        void saveAndClose();
      }}
    >
      <PanelSurface
        variant={surface}
        label="编辑任务"
        onClose={requestClose}
        header={header}
        rootRef={rootRef}
      >
        {body}
      </PanelSurface>
    </div>
  );

  if (loadError || !form || !loaded) {
    const header =
      surface === 'inline' && row ? (
        <div className="task-row task-row-editing">
          <div className="task-main-editing">
            <span className="task-title">{row.title}</span>
          </div>
        </div>
      ) : null;
    return wrap(header, <p className="muted panel-message">{loadError ?? '加载中…'}</p>);
  }

  const errors: FormErrors = validateTaskForm(form);
  // 按任务所属的项目取功能、名单和权限
  const scope = scopeOf(loaded.task.projectId);
  const project =
    scope?.project ?? data?.projects.find((p) => p.id === loaded.task.projectId) ?? null;
  const features = featuresForProject(project);
  const members = scope?.members ?? [];
  const contacts = scope?.contacts ?? [];
  const myId = scope?.me?.userId;

  // 任务关系：开始 / 结束两行（关系对象的候选、默认范围、算出的日期）
  const scheduleProps =
    data && form.schedule && scheduleEligible(loaded.task, form, data)
      ? (() => {
          const scopes = relationScopes(loaded.task, data);
          const selectedCategory =
            selection.categoryIds.length === 1 ? selection.categoryIds[0] : null;
          const relationCategories = form.categoryIds.filter((id) =>
            data.categories.find((c) => c.id === id)?.tools.includes('relations'),
          );
          const defaultScopeId =
            loaded.task.projectId ??
            (selectedCategory && relationCategories.includes(selectedCategory)
              ? selectedCategory
              : (relationCategories[0] ?? scopes[0]?.id ?? ''));
          return {
            scopes,
            defaultScopeId,
            computed: previewDates(form.schedule, form.deadline, data, timeZone),
          };
        })()
      : undefined;
  const me = (raci: TaskFormValue['raci']) =>
    raci.filter((a) => a.userId !== null && a.userId === myId).map((a) => a.role);
  const categories: Category[] = data?.categories ?? [];

  /** 历史中某次实例：勾上 = 已完成，没勾 = 未完成 */
  async function toggleRecord(record: RecurrenceOccurrence, completed: boolean) {
    try {
      const updated = await repositories.occurrences.setStatus(
        record.id,
        completed ? 'completed' : 'missed',
        completed ? new Date() : null,
      );
      setLoaded((l) =>
        l ? { ...l, records: l.records.map((r) => (r.id === updated.id ? updated : r)) } : l,
      );
      void reload();
    } catch (e) {
      setSaveState('error');
      setSaveError(errorMessage(e));
    }
  }

  // 组任务不使用重要性、分类和收藏
  const inGroup = loaded.task.groupId !== null;
  // 内容由项目管理员编辑；开了任务分配时 R 标记完成，A 确认或不通过
  const myRaci = me(form.raci);
  const perms = taskPermissions(project, myRaci);
  const pending = loaded.task.completedAt !== null && loaded.task.confirmedAt === null;

  /** A 确认完成 / 不通过（回到未完成） */
  async function settle(approve: boolean) {
    const task = taskRef.current;
    if (!task) return;
    try {
      const next = await repositories.tasks.update(
        task.id,
        approve ? { confirmedAt: new Date() } : { completedAt: null },
      );
      taskRef.current = next;
      setLoaded((l) => (l ? { ...l, task: next } : l));
      if (!approve) {
        formRef.current = { ...formRef.current!, completed: false };
        savedRef.current = { ...savedRef.current!, completed: false };
        setForm((f) => (f ? { ...f, completed: false } : f));
      }
      void reload();
    } catch (e) {
      setSaveState('error');
      setSaveError(errorMessage(e));
    }
  }
  const confirmBar = pending && perms.confirm && (
    <div className="confirm-bar" role="group" aria-label="完成确认">
      <button type="button" className="button-primary button-small" onClick={() => settle(true)}>
        确认
      </button>
      <button type="button" className="button-danger button-small" onClick={() => settle(false)}>
        不通过
      </button>
    </div>
  );
  const star = !inGroup && (
    <StarButton
      starred={form.isStarred}
      onToggle={() => onChange({ isStarred: !form.isStarred })}
    />
  );
  const completeButton = !form.recurrence.enabled &&
    (form.completed ? perms.uncomplete : perms.complete) && (
      <IconButton
        label={form.completed ? '标记为未完成' : '标记为完成'}
        className={form.completed ? 'icon-button-active' : ''}
        aria-pressed={form.completed}
        onClick={() => onChange({ completed: !form.completed })}
      >
        <CheckCircleIcon />
      </IconButton>
    );
  const deleteButton = perms.edit && (
    <IconButton label="删除任务" className="icon-button-danger" onClick={deleteTask}>
      <TrashIcon />
    </IconButton>
  );
  const setTitle = (title: string) => perms.edit && onChange({ title });
  // 子任务的勾选：普通任务不分次；循环任务是当前代表的那一次。勾了立即生效（不发通知）
  const series = seriesFromTask(loaded.task);
  const occurrenceDate = series
    ? (resolveRepresentativeInstance(series, data?.occurrencesByTask.get(loaded.task.id) ?? [], {
        now,
        timeZone,
      })?.occurrenceAt ?? null)
    : null;
  const subtaskChecks =
    series && !occurrenceDate
      ? undefined
      : {
          isChecked: (subtaskId: string) =>
            (data?.subtaskChecks ?? []).some(
              (c) =>
                c.subtaskId === subtaskId &&
                (c.occurrenceDate?.getTime() ?? null) === (occurrenceDate?.getTime() ?? null),
            ),
          canCheck: loaded.task.groupId === null || (features.raci ? myRaci.includes('R') : true),
          onToggle: (subtaskId: string, checked: boolean) => {
            const subtask = data?.subtasksByTask
              .get(loaded.task.id)
              ?.find((x) => x.id === subtaskId);
            if (subtask) void toggleSubtask(subtask, occurrenceDate, checked);
          },
        };

  // 右侧是 ✓：保存并收起（改动只在这里保存）
  const doneButton = (
    <IconButton
      label="完成编辑"
      className="icon-button-primary edit-done"
      onClick={() => void saveAndClose()}
    >
      <CheckIcon />
    </IconButton>
  );

  // 列表中：标题留在原来那一行并变为可编辑（桌面）；手机底部抽屉里另有一行标题
  const inlineRow = surface === 'inline' && row;
  const header = inlineRow ? (
    <div className={`task-row task-row-editing${form.completed ? ' task-completed' : ''}`}>
      {row.checkbox(form, onChange)}
      <div className="task-main-editing">
        <input
          className="task-title-input desktop-only"
          aria-label="标题"
          placeholder="标题"
          value={form.title}
          autoFocus={focusTitle && perms.edit}
          readOnly={!perms.edit}
          onChange={(event) => setTitle(event.target.value)}
        />
        <span className="task-title mobile-only">{form.title}</span>
        {row.meta}
      </div>
      <div className="row-actions desktop-only">
        {star}
        {deleteButton}
        {doneButton}
      </div>
    </div>
  ) : null;

  const titleRow = (
    <EditorTitleRow
      className={inlineRow ? 'mobile-only' : ''}
      value={form.title}
      onChange={setTitle}
      readOnly={!perms.edit}
      actions={
        <>
          {star}
          {completeButton}
          {deleteButton}
          {doneButton}
        </>
      }
    />
  );

  return wrap(
    header,
    <>
      {confirmBar}
      <TaskEditor
        value={form}
        onChange={onChange}
        errors={errors}
        categories={categories}
        inGroup={inGroup}
        readOnly={!perms.edit}
        raci={features.raci ? { members, contacts, editable: perms.edit } : undefined}
        schedule={scheduleProps}
        records={loaded.records}
        onToggleRecord={toggleRecord}
        now={now}
        timeZone={timeZone}
        fallbackStart={loaded.task.deadlineAt}
        onToggle={requestClose}
        onRemovePerson={removePerson}
        titleRow={titleRow}
        subtaskChecks={subtaskChecks}
        historyProgress={(date) => {
          const all = data?.subtasksByTask.get(loaded.task.id) ?? [];
          const progress = subtaskProgress(all, data?.subtaskChecks ?? [], date);
          return progress.total > 0 ? `${progress.done}/${progress.total}` : null;
        }}
      />
      {saveState === 'error' && saveError && (
        <p className="field-error panel-message">保存失败：{saveError}</p>
      )}
    </>,
  );
}
