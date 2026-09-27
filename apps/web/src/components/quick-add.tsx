'use client';

import { normalizeTaskTitle, type Category } from '@alethego/core';
import { useState, type FormEvent } from 'react';

import { useTaskData } from './task-data-provider';

/**
 * 快速添加：输入标题回车即创建，其余字段之后在详情中补充。
 * 传入 category 时新任务自动归入该分类（分类页，或总览页只点亮了这一个分类标签）。
 */
export function QuickAdd({ category }: { category: Category | null }) {
  const { createTask } = useTaskData();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeTaskTitle(title);
    if (!normalized) return;
    setTitle('');
    const result = await createTask(normalized, category?.id ?? null);
    if (result.ok) {
      setError(null);
      return;
    }
    // 任务已创建但分类没挂上时不回填标题，避免重复创建
    if (!result.created) setTitle(normalized);
    setError(
      result.created
        ? `任务已创建，但未能归入「${category?.name}」：${result.message}`
        : `创建失败：${result.message}`,
    );
  }

  return (
    <form className="quick-add" onSubmit={handleSubmit}>
      <span className="quick-add-plus" aria-hidden>
        +
      </span>
      <input
        aria-label="快速添加任务"
        placeholder={category ? `添加到「${category.name}」，回车创建` : '添加任务，回车创建'}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        autoFocus
      />
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
