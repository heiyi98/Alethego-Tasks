'use client';

import {
  DEFAULT_CATEGORY_PALETTE,
  STATUS_FILTERS,
  nextAvailablePaletteColor,
  type Category,
  type StatusFilter,
} from '@alethego/core';
import { useState, type FormEvent } from 'react';

import { CategoryDot } from './category-dot';
import { useRepositories } from './repositories-provider';
import { STATUS_LABELS, errorMessage } from '@/lib/format';

export function StatusFilterBar({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (status: StatusFilter) => void;
}) {
  return (
    <div className="chip-row" role="group" aria-label="状态筛选">
      {STATUS_FILTERS.map((status) => (
        <button
          key={status}
          type="button"
          className="chip"
          aria-pressed={value === status}
          onClick={() => onChange(status)}
        >
          {STATUS_LABELS[status]}
        </button>
      ))}
    </div>
  );
}

/** 调色板用尽后随机生成一个未使用的颜色（不因颜色不足限制分类数量）。 */
function pickColor(categories: readonly Category[]): string {
  const used = categories.map((c) => c.color);
  const fromPalette = nextAvailablePaletteColor(used);
  if (fromPalette) return fromPalette;
  const usedSet = new Set(used.map((c) => c.toUpperCase()));
  for (;;) {
    const color = `#${Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')
      .toUpperCase()}`;
    if (!usedSet.has(color)) return color;
  }
}

export function CategoryFilterBar({
  categories,
  selected,
  onToggle,
  onCreated,
}: {
  categories: readonly Category[];
  selected: readonly string[];
  onToggle: (categoryId: string) => void;
  onCreated: () => void | Promise<void>;
}) {
  const repositories = useRepositories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await repositories.categories.create({ name: trimmed, color: pickColor(categories) });
      setName('');
      setAdding(false);
      setError(null);
      await onCreated();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="chip-row" role="group" aria-label="分类筛选">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className="chip"
          aria-pressed={selected.includes(category.id)}
          onClick={() => onToggle(category.id)}
        >
          <CategoryDot color={category.color} />
          {category.name}
        </button>
      ))}
      {adding ? (
        <form className="inline-form" onSubmit={handleCreate}>
          <input
            aria-label="新分类名称"
            placeholder="分类名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setAdding(false)}
            autoFocus
          />
          <button type="submit" className="chip">
            添加
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="chip chip-ghost"
          onClick={() => setAdding(true)}
          title={`默认调色板共 ${DEFAULT_CATEGORY_PALETTE.length} 色`}
        >
          + 新建分类
        </button>
      )}
      {error && <p className="field-error">创建分类失败：{error}</p>}
    </div>
  );
}
