'use client';

import { normalizeTaskTitle, type Category } from '@alethego/core';
import { useState, type FormEvent } from 'react';

import { useFeedback } from './feedback-provider';
import { usePanels } from './panel-provider';
import { QuickOptionsRow } from './task-editor';
import { CreatePanel, useCreateTask } from './task-panels';
import { validateTaskForm, type TaskFormValue } from '@/lib/task-form';

/**
 * 快速添加：标题 + 下方一行常用选项（重要性、截止日期），回车即创建；
 * 最右侧的三角展开完整的新建面板。收起面板时草稿保留。
 * 传入 category 时新任务默认归入该分类（分类页，或总览页只点亮了这一个分类标签）。
 */
export function QuickAdd({ category }: { category: Category | null }) {
  const { draft, setDraft, resetDraft, open, close, isOpen } = usePanels();
  const { notify } = useFeedback();
  const createTask = useCreateTask();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultCategoryIds = category ? [category.id] : [];
  const expanded = isOpen({ kind: 'create' });

  if (expanded) return <CreatePanel defaultCategoryIds={defaultCategoryIds} />;

  const form: TaskFormValue = { ...draft, categoryIds: draft.categoryIds ?? defaultCategoryIds };
  const onChange = (patch: Partial<TaskFormValue>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizeTaskTitle(form.title) || busy) return;
    // 展开面板里填过的内容（例如不完整的重复规则）有问题时，展开面板让用户看到错误
    if (Object.keys(validateTaskForm(form)).length > 0) {
      open({ kind: 'create' });
      return;
    }
    setBusy(true);
    const result = await createTask(form);
    setBusy(false);
    if (!result.created) {
      setError(result.message ?? null);
      return;
    }
    resetDraft();
    if (result.message) notify(result.message);
  }

  return (
    <form className="quick-add" onSubmit={handleSubmit}>
      <div className="quick-add-input">
        <span className="quick-add-plus" aria-hidden>
          +
        </span>
        <input
          aria-label="快速添加任务"
          placeholder={category ? `添加到「${category.name}」，回车创建` : '添加任务，回车创建'}
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
          autoFocus
        />
      </div>
      <QuickOptionsRow
        value={form}
        onChange={onChange}
        expanded={false}
        onToggle={() => (expanded ? close() : open({ kind: 'create' }))}
        toggleLabel="展开完整选项"
      />
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
