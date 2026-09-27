'use client';

import type { Category, StatusFilter } from '@alethego/core';

import { CategoryDot } from './category-dot';
import { STATUS_LABELS, STATUS_ORDER } from '@/lib/format';

/** 页面内的分类标签（多选，命中其一即显示；都不选 = 不按分类筛选） */
export function CategoryTags({
  categories,
  selected,
  onToggle,
}: {
  categories: readonly Category[];
  selected: readonly string[];
  onToggle: (categoryId: string) => void;
}) {
  if (categories.length === 0) return null;
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
    </div>
  );
}

/** 页面内的状态标签（单选） */
export function StatusTags({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (status: StatusFilter) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label="状态筛选">
      {STATUS_ORDER.map((status) => (
        <button
          key={status}
          type="button"
          aria-pressed={value === status}
          onClick={() => onChange(status)}
        >
          {STATUS_LABELS[status]}
        </button>
      ))}
    </div>
  );
}
