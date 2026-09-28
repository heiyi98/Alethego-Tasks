'use client';

import {
  normalizeLocationDraft,
  normalizePeopleDrafts,
  type Category,
  type RecurrenceOccurrence,
  type Task,
} from '@alethego/core';
import { loadTaskDetail, saveTaskExtensions, syncOccurrences } from '@alethego/data';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useFeedback } from './feedback-provider';
import { CheckCircleIcon, CheckIcon, ClockIcon, IconButton, TrashIcon, XIcon } from './icons';
import { PanelSurface } from './panel-surface';
import { usePanels } from './panel-provider';
import { useRepositories } from './repositories-provider';
import { TaskEditor } from './task-editor';
import { useTaskData } from './task-data-provider';
import { errorMessage } from '@/lib/format';
import {
  isDraftDirty,
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

/** 展开后的新建面板（草稿保存在 PanelProvider 中，收起不丢失） */
export function CreatePanel({ defaultCategoryIds }: { defaultCategoryIds: string[] }) {
  const { draft, setDraft, resetDraft, close } = usePanels();
  const { data, now, timeZone } = useTaskData();
  const { confirm, showUndo, notify } = useFeedback();
  const createTask = useCreateTask();
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form: TaskFormValue = { ...draft, categoryIds: draft.categoryIds ?? defaultCategoryIds };
  const onChange = (patch: Partial<TaskFormValue>) => {
    setErrors({});
    setMessage(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  async function submit() {
    const found = validateTaskForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0 || busy) return;
    setBusy(true);
    const result = await createTask(form);
    setBusy(false);
    // 创建失败时保留草稿与面板，显示原因；已创建（哪怕部分信息失败）则清空草稿，避免重复创建
    if (!result.created) {
      setMessage(result.message ?? null);
      return;
    }
    resetDraft();
    close();
    if (result.message) notify(result.message);
  }

  async function discard() {
    if (isDraftDirty(form, defaultCategoryIds)) {
      const ok = await confirm({
        message: '放弃这个新任务？',
        detail: '已填写的内容将被丢弃',
        confirmLabel: '放弃',
        cancelLabel: '继续编辑',
        destructive: true,
      });
      if (!ok) return;
    }
    resetDraft();
    close();
  }

  function removePerson(index: number) {
    const removed = form.people[index];
    if (!removed) return;
    onChange({ people: form.people.filter((_, i) => i !== index) });
    if (removed.name.trim() || removed.relation.trim()) {
      showUndo(`已删除人物「${removed.name || removed.relation}」`, () =>
        setDraft((d) => {
          const people = [...d.people];
          people.splice(Math.min(index, people.length), 0, removed);
          return { ...d, people };
        }),
      );
    }
  }

  return (
    <PanelSurface variant="inline" label="新建任务" onClose={close}>
      <div
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.target as HTMLElement).getAttribute('aria-label') === '标题'
          ) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <TaskEditor
          mode="create"
          value={form}
          onChange={onChange}
          errors={errors}
          categories={data?.categories ?? []}
          records={[]}
          now={now}
          timeZone={timeZone}
          fallbackStart={null}
          onToggle={close}
          onRemovePerson={removePerson}
          actions={
            <>
              <IconButton label="放弃" onClick={discard}>
                <XIcon />
              </IconButton>
              <IconButton label="创建" className="icon-button-primary" onClick={submit}>
                <CheckIcon />
              </IconButton>
            </>
          }
        />
        {message && <p className="field-error">{message}</p>}
      </div>
    </PanelSurface>
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
export function EditPanel({ taskId, surface }: { taskId: string; surface: 'inline' | 'floating' }) {
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
        const initial = taskFormFromDetail(detail);
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

      const patch = taskPatchFromForms(current, saved, timeZone, task.deadlineAt);
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

        if (patch.recurrenceRule !== undefined) {
          const records = await syncOccurrences(repositories.occurrences, nextTask, {
            now: new Date(),
            timeZone,
          });
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

  if (loadError || !form || !loaded) {
    return (
      <PanelSurface variant={surface} label="编辑任务" onClose={close}>
        <p className="muted panel-message">{loadError ?? '加载中…'}</p>
      </PanelSurface>
    );
  }

  const errors: FormErrors = validateTaskForm(form);
  const recurring = loaded.task.recurrenceRule !== null;
  const showHistory = recurring || loaded.records.length > 0;
  const categories: Category[] = data?.categories ?? [];

  return (
    <PanelSurface variant={surface} label="编辑任务" onClose={close}>
      <TaskEditor
        mode="edit"
        value={form}
        onChange={onChange}
        errors={errors}
        categories={categories}
        records={loaded.records}
        now={now}
        timeZone={timeZone}
        fallbackStart={loaded.task.deadlineAt}
        saveState={saveState}
        onToggle={close}
        onRemovePerson={removePerson}
        actions={
          <>
            {!form.recurrence.enabled && (
              <IconButton
                label={form.completed ? '标记为未完成' : '标记为完成'}
                className={form.completed ? 'icon-button-active' : ''}
                aria-pressed={form.completed}
                onClick={() => onChange({ completed: !form.completed })}
              >
                <CheckCircleIcon />
              </IconButton>
            )}
            {showHistory && (
              <Link
                href={`/tasks/${loaded.task.id}/history`}
                className="icon-button"
                aria-label={`历史记录（${loaded.records.length} 次）`}
                title={`历史记录（${loaded.records.length} 次）`}
              >
                <ClockIcon />
              </Link>
            )}
            <IconButton label="删除任务" className="icon-button-danger" onClick={deleteTask}>
              <TrashIcon />
            </IconButton>
          </>
        }
      />
      {saveState === 'error' && saveError && (
        <p className="field-error panel-message">保存失败：{saveError}</p>
      )}
    </PanelSurface>
  );
}
