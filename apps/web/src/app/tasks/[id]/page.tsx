'use client';

import { normalizeTaskTitle, type Category, type ImportanceLevel, type Task } from '@alethego/core';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { CategoryDot } from '@/components/category-dot';
import { useRepositories } from '@/components/repositories-provider';
import {
  IMPORTANCE_LEVELS,
  errorMessage,
  fromDateTimeLocalValue,
  importanceLabel,
  toDateTimeLocalValue,
} from '@/lib/format';
import { lastListUrl } from '@/lib/list-url';

interface FormState {
  title: string;
  description: string;
  deadline: string;
  importanceLevel: ImportanceLevel;
  categoryIds: string[];
  completed: boolean;
}

function toFormState(task: Task, categoryIds: string[]): FormState {
  return {
    title: task.title,
    description: task.description,
    deadline: toDateTimeLocalValue(task.deadlineAt),
    importanceLevel: task.importanceLevel,
    categoryIds,
    completed: task.completedAt !== null,
  };
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; task: Task; categories: Category[] };

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const repositories = useRepositories();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [task, categories, links] = await Promise.all([
          repositories.tasks.getById(id),
          repositories.categories.list(),
          repositories.categories.listCategoryIdsByTask([id]),
        ]);
        if (cancelled) return;
        if (!task) {
          setLoad({ kind: 'not_found' });
          return;
        }
        setLoad({ kind: 'ready', task, categories });
        setForm(toFormState(task, links.get(id) ?? []));
      } catch (e) {
        if (!cancelled) setLoad({ kind: 'error', message: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, repositories]);

  if (load.kind === 'loading') return <DetailShell>加载中…</DetailShell>;
  if (load.kind === 'not_found') return <DetailShell>任务不存在或已删除。</DetailShell>;
  if (load.kind === 'error') return <DetailShell>加载失败：{load.message}</DetailShell>;
  if (!form) return null;

  const { task, categories } = load;
  const update = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  function toggleCategory(categoryId: string) {
    update({
      categoryIds: form!.categoryIds.includes(categoryId)
        ? form!.categoryIds.filter((c) => c !== categoryId)
        : [...form!.categoryIds, categoryId],
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = normalizeTaskTitle(form!.title);
    if (!title) {
      setMessage({ kind: 'error', text: '标题不能为空' });
      return;
    }
    setSaving(true);
    try {
      const saved = await repositories.tasks.update(task.id, {
        title,
        description: form!.description,
        deadlineAt: fromDateTimeLocalValue(form!.deadline),
        importanceLevel: form!.importanceLevel,
        completedAt: form!.completed ? (task.completedAt ?? new Date()) : null,
      });
      await repositories.categories.setTaskCategories(task.id, form!.categoryIds);
      setLoad({ kind: 'ready', task: saved, categories });
      setForm(toFormState(saved, form!.categoryIds));
      setMessage({ kind: 'ok', text: '已保存' });
    } catch (e) {
      setMessage({ kind: 'error', text: `保存失败：${errorMessage(e)}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`删除任务「${task.title}」？`)) return;
    try {
      await repositories.tasks.delete(task.id);
      router.push(lastListUrl());
    } catch (e) {
      setMessage({ kind: 'error', text: `删除失败：${errorMessage(e)}` });
    }
  }

  return (
    <main className="page">
      <BackLink />
      <form className="detail-form" onSubmit={handleSave} aria-label="任务详情">
        <label className="field">
          <span className="field-label">标题</span>
          <input
            name="title"
            value={form.title}
            onChange={(event) => update({ title: event.target.value })}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">描述</span>
          <textarea
            name="description"
            rows={4}
            value={form.description}
            onChange={(event) => update({ description: event.target.value })}
          />
        </label>

        <div className="field">
          <label className="field-label" htmlFor="deadline">
            截止时间
          </label>
          <div className="field-inline">
            <input
              id="deadline"
              name="deadline"
              type="datetime-local"
              value={form.deadline}
              onChange={(event) => update({ deadline: event.target.value })}
            />
            {form.deadline && (
              <button
                type="button"
                className="button-ghost"
                onClick={() => update({ deadline: '' })}
              >
                清除
              </button>
            )}
          </div>
        </div>

        <fieldset className="field">
          <legend className="field-label">重要性</legend>
          <div className="chip-row">
            {IMPORTANCE_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className="chip"
                aria-pressed={form.importanceLevel === level}
                onClick={() => update({ importanceLevel: level })}
              >
                {importanceLabel(level)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend className="field-label">分类</legend>
          {categories.length === 0 ? (
            <p className="muted">还没有分类，可在列表页新建。</p>
          ) : (
            <div className="chip-row">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className="chip"
                  aria-pressed={form.categoryIds.includes(category.id)}
                  onClick={() => toggleCategory(category.id)}
                >
                  <CategoryDot color={category.color} />
                  {category.name}
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <label className="field field-checkbox">
          <input
            type="checkbox"
            checked={form.completed}
            onChange={(event) => update({ completed: event.target.checked })}
          />
          已完成
        </label>

        {message && (
          <p className={message.kind === 'ok' ? 'notice' : 'notice notice-error'} role="status">
            {message.text}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" className="button-danger" onClick={handleDelete}>
            删除
          </button>
        </div>
      </form>
    </main>
  );
}

function BackLink() {
  const [href, setHref] = useState('/');
  useEffect(() => setHref(lastListUrl()), []);
  return (
    <Link href={href} className="back-link">
      ← 返回列表
    </Link>
  );
}

function DetailShell({ children }: { children: ReactNode }) {
  return (
    <main className="page">
      <BackLink />
      <p className="muted">{children}</p>
    </main>
  );
}
