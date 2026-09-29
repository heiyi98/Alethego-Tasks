'use client';

import {
  normalizeLocationDraft,
  normalizePeopleDrafts,
  type Category,
  type RecurrenceOccurrence,
  type Task,
} from '@alethego/core';
import { loadTaskDetail, saveTaskExtensions, syncOccurrences } from '@alethego/data';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useFeedback } from './feedback-provider';
import { CheckCircleIcon, CheckIcon, IconButton, TrashIcon } from './icons';
import { PanelSurface } from './panel-surface';
import { usePanels } from './panel-provider';
import { useRepositories } from './repositories-provider';
import { EditorTitleRow, StarButton, TaskEditor } from './task-editor';
import { useTaskData } from './task-data-provider';
import { errorMessage } from '@/lib/format';
import {
  locationDraft,
  newTaskFromForm,
  peopleDrafts,
  peopleRows,
  sameLocation,
  samePeople,
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

/** 新建：把草稿写入数据库（任务 + 分类 + 地点 / 人物） */
export function useCreateTask() {
  const repositories = useRepositories();
  const { reload, timeZone } = useTaskData();
  return useCallback(
    async (form: TaskFormValue): Promise<{ created: boolean; message?: string }> => {
      try {
        const task = await repositories.tasks.create(newTaskFromForm(form, timeZone));
        try {
          if (form.categoryIds.length > 0) {
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
    [repositories, reload, timeZone],
  );
}

/* ------------------------------------------------------------------ */
/* 编辑（自动保存）                                                     */
/* ------------------------------------------------------------------ */

const SAVE_DELAY_MS = 500;

/** pending：有改动等待保存；invalid：有不合法的字段，暂不保存 */
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error';

interface Loaded {
  task: Task;
  records: RecurrenceOccurrence[];
}

/**
 * 编辑已有任务：与新建共用 TaskEditor；改动自动保存（防抖），没有保存 / 还原按钮。
 * 收起（卸载）时立即保存尚未提交的改动。
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
  const { data, now, timeZone, reload } = useTaskData();
  const { close } = usePanels();
  const { showUndo } = useFeedback();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<TaskFormValue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // 保存相关的状态放在 ref 里，卸载时的 flush 也能拿到最新值
  const formRef = useRef<TaskFormValue | null>(null);
  const savedRef = useRef<TaskFormValue | null>(null);
  const taskRef = useRef<Task | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

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
        const records = await syncOccurrences(repositories.occurrences, detail.task, {
          now: new Date(),
          timeZone,
        });
        if (cancelled) return;
        const initial = taskFormFromDetail(detail, timeZone);
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

  /** 把当前表单与上次保存的差异写入数据库 */
  const saveNow = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    chain.current = chain.current.then(async () => {
      const current = formRef.current;
      const saved = savedRef.current;
      const task = taskRef.current;
      if (!current || !saved || !task) return;

      const patch = taskPatchFromForms(current, saved, timeZone);
      const categoriesChanged =
        [...current.categoryIds].sort().join() !== [...saved.categoryIds].sort().join();
      const people = normalizePeopleDrafts(current.people);
      const extensionsChanged =
        !sameLocation(current.location, saved.location) ||
        !samePeople(current.people, saved.people);
      if (
        Object.keys(patch).length === 0 &&
        !categoriesChanged &&
        !(extensionsChanged && people.ok)
      ) {
        setSaveState(Object.keys(validateTaskForm(current)).length > 0 ? 'invalid' : 'saved');
        return;
      }

      setSaveState('saving');
      try {
        let nextTask = task;
        if (Object.keys(patch).length > 0)
          nextTask = await repositories.tasks.update(task.id, patch);
        if (categoriesChanged) {
          await repositories.categories.setTaskCategories(task.id, current.categoryIds);
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

        // 已保存的快照：本次实际写入的字段取当前值，其余沿用上次
        savedRef.current = {
          ...saved,
          title: patch.title !== undefined ? current.title : saved.title,
          description: current.description,
          deadline: current.recurrence.enabled ? saved.deadline : current.deadline,
          deadlineTime: current.recurrence.enabled ? saved.deadlineTime : current.deadlineTime,
          isStarred: current.isStarred,
          importanceLevel: current.importanceLevel,
          completed: current.recurrence.enabled ? saved.completed : current.completed,
          recurrence: patch.recurrenceRule !== undefined ? current.recurrence : saved.recurrence,
          categoryIds: current.categoryIds,
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
        // 保存期间又有新改动时保持 pending；仍有不合法字段（未写入）时为 invalid
        const invalid = Object.keys(validateTaskForm(formRef.current ?? current)).length > 0;
        setSaveState(timer.current ? 'pending' : invalid ? 'invalid' : 'saved');
        setSaveError(null);
        void reload();
      } catch (e) {
        setSaveState('error');
        setSaveError(errorMessage(e));
      }
    });
    return chain.current;
  }, [repositories, timeZone, reload, showUndo]);

  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  // 收起 / 卸载时立即保存
  useEffect(
    () => () => {
      if (timer.current) void saveNowRef.current();
    },
    [],
  );

  function onChange(patch: Partial<TaskFormValue>) {
    if (!formRef.current) return;
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    setSaveState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNowRef.current(), SAVE_DELAY_MS);
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
    // 先保存未提交的改动，撤销删除后内容完整
    await saveNowRef.current();
    await repositories.tasks.delete(task.id);
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
      data-save-state={saveState}
    >
      <PanelSurface variant={surface} label="编辑任务" onClose={close} header={header}>
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

  const star = (
    <StarButton
      starred={form.isStarred}
      onToggle={() => onChange({ isStarred: !form.isStarred })}
    />
  );
  const completeButton = !form.recurrence.enabled && (
    <IconButton
      label={form.completed ? '标记为未完成' : '标记为完成'}
      className={form.completed ? 'icon-button-active' : ''}
      aria-pressed={form.completed}
      onClick={() => onChange({ completed: !form.completed })}
    >
      <CheckCircleIcon />
    </IconButton>
  );
  const deleteButton = (
    <IconButton label="删除任务" className="icon-button-danger" onClick={deleteTask}>
      <TrashIcon />
    </IconButton>
  );
  const setTitle = (title: string) => onChange({ title });
  // 任务已经存在：右侧是 ✓，点击立即保存并收起（改动本来就会自动保存）
  const doneButton = (
    <IconButton
      label="完成编辑"
      className="icon-button-primary edit-done"
      onClick={async () => {
        await saveNowRef.current();
        close();
      }}
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
          autoFocus={focusTitle}
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
      <TaskEditor
        value={form}
        onChange={onChange}
        errors={errors}
        categories={categories}
        records={loaded.records}
        onToggleRecord={toggleRecord}
        now={now}
        timeZone={timeZone}
        fallbackStart={loaded.task.deadlineAt}
        onToggle={close}
        onRemovePerson={removePerson}
        titleRow={titleRow}
      />
      {saveState === 'error' && saveError && (
        <p className="field-error panel-message">保存失败：{saveError}</p>
      )}
    </>,
  );
}
