'use client';

import { normalizeTaskTitle, type Category } from '@alethego/core';
import { useState, type FormEvent } from 'react';

import { useRepositories } from './repositories-provider';
import { errorMessage } from '@/lib/format';

/**
 * 快速添加：输入标题回车即创建，其余字段之后在详情中补充。
 * 传入 category 时（列表只点亮了这一个分类），新任务自动归入该分类。
 */
export function QuickAdd({
  category,
  onCreated,
}: {
  category: Category | null;
  onCreated: () => void | Promise<void>;
}) {
  const repositories = useRepositories();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeTaskTitle(title);
    if (!normalized) return;
    setTitle('');
    let created = false;
    try {
      const task = await repositories.tasks.create({ title: normalized });
      created = true;
      if (category) await repositories.categories.setTaskCategories(task.id, [category.id]);
      setError(null);
    } catch (e) {
      // 任务已创建但分类没挂上时不回填标题，避免重复创建
      if (!created) setTitle(normalized);
      setError(
        created
          ? `任务已创建，但未能归入「${category?.name}」：${errorMessage(e)}`
          : `创建失败：${errorMessage(e)}`,
      );
    }
    await onCreated();
  }

  return (
    <form className="quick-add" onSubmit={handleSubmit}>
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
