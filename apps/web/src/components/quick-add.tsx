'use client';

import { normalizeTaskTitle } from '@alethego/core';
import { useState, type FormEvent } from 'react';

import { useRepositories } from './repositories-provider';
import { errorMessage } from '@/lib/format';

/** 快速添加：输入标题回车即创建，其余字段之后在详情中补充。 */
export function QuickAdd({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { tasks } = useRepositories();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeTaskTitle(title);
    if (!normalized) return;
    setTitle('');
    try {
      await tasks.create({ title: normalized });
      setError(null);
      await onCreated();
    } catch (e) {
      setTitle(normalized);
      setError(errorMessage(e));
    }
  }

  return (
    <form className="quick-add" onSubmit={handleSubmit}>
      <input
        aria-label="快速添加任务"
        placeholder="添加任务，回车创建"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        autoFocus
      />
      {error && <p className="field-error">创建失败：{error}</p>}
    </form>
  );
}
