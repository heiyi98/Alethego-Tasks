'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CategoryDot } from './category-dot';
import { CategoryForm } from './category-form';
import { IconButton, XIcon } from './icons';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { selectionHref, toggleCategory } from '@/lib/selection';

/**
 * 页面标题栏（清单页与矩阵页共用）：
 * - 收藏：永远只显示"收藏"（分类筛选照常生效，侧边栏的分类开关保持高亮）
 * - 没选分类：显示"总览"
 * - 选了分类：每个分类一个胶囊（名字 + ✕）。点 ✕ 取消这个分类的选择；点名字打开这个分类的编辑
 *
 * 标题栏由一栏或多栏组成，每栏高度固定；胶囊放不下时另起一栏。栏数不变时下方内容不动。
 */
export function TitleBar() {
  const { data, reload } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);

  const go = (href: string) => router.replace(href, { scroll: false });
  const categories = selection.categoryIds
    .map((id) => data?.categories.find((c) => c.id === id))
    .filter((c) => c !== undefined);
  const editingCategory = categories.find((c) => c.id === editing);

  if (selection.scope === 'starred' || categories.length === 0) {
    return (
      <header className="page-header">
        <h1 className="title-bar">
          <span className="title-bar-text">{selection.scope === 'starred' ? '收藏' : '总览'}</span>
        </h1>
      </header>
    );
  }

  return (
    <header className="page-header">
      <h1 className="title-bar" aria-label={categories.map((c) => c.name).join('、')}>
        {categories.map((category) => (
          <span key={category.id} className="title-capsule" data-testid="title-capsule">
            <button
              type="button"
              className="title-capsule-name"
              title={category.description || undefined}
              aria-expanded={editing === category.id}
              onClick={() => setEditing(editing === category.id ? null : category.id)}
            >
              <CategoryDot color={category.color} />
              {category.name}
            </button>
            <IconButton
              label={`取消选择「${category.name}」`}
              className="title-capsule-remove"
              onClick={() => {
                if (editing === category.id) setEditing(null);
                go(selectionHref(toggleCategory(selection, category.id)));
              }}
            >
              <XIcon size={14} />
            </IconButton>
          </span>
        ))}
      </h1>
      {editingCategory && data && (
        <div className="title-popover" data-keep-panel>
          <CategoryForm
            key={editingCategory.id}
            categories={data.categories}
            category={editingCategory}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reload();
            }}
            onDeleted={async (deleted) => {
              setEditing(null);
              go(selectionHref(toggleCategory(selection, deleted.id)));
              await reload();
            }}
          />
        </div>
      )}
    </header>
  );
}
