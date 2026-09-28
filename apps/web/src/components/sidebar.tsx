'use client';

import { buildTaskList, type StatusFilter } from '@alethego/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { CategoryDot } from './category-dot';
import { CategoryForm } from './category-form';
import { IconButton, PencilIcon } from './icons';
import { ModeToggle } from './mode-toggle';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { STATUS_LABELS, STATUS_ORDER } from '@/lib/format';
import { selectionHref, toggleCategory } from '@/lib/selection';

const STATUS_ICONS: Record<StatusFilter, string> = {
  all: '☰',
  starred: '★',
  todo: '○',
  completed: '✓',
  missed: '!',
};

/**
 * 左侧菜单，也是唯一的筛选入口（页面内不再有分类 / 状态标签）：
 * - 上方「状态」：单选一项
 * - 下方「分类」：每个分类是一个开关，可多选累加；一个都不选 = 所有分类
 * 页面内容 = 所选状态 ∩（命中任一所选分类）。清单与矩阵共用同一套选择。
 */
export function Sidebar() {
  const { data, now, timeZone, reload } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  // 同一时间只打开一个分类表单：'new' = 新建，其他值 = 正在编辑的分类 id
  const [editing, setEditing] = useState<string | null>(null);

  const counts = useMemo(() => {
    if (!data) return null;
    const sources = {
      tasks: data.tasks,
      categoryIdsByTask: data.categoryIdsByTask,
      occurrencesByTask: data.occurrencesByTask,
    };
    const context = { now, timeZone };
    // 状态项：在当前所选分类范围内的数量；分类项：当前状态下该分类的数量
    const byStatus = Object.fromEntries(
      STATUS_ORDER.map((status) => [
        status,
        buildTaskList(sources, { status, categoryIds: selection.categoryIds }, context).length,
      ]),
    ) as Record<StatusFilter, number>;
    const byCategory = new Map(
      data.categories.map((c) => [
        c.id,
        buildTaskList(sources, { status: selection.status, categoryIds: [c.id] }, context).length,
      ]),
    );
    return { byStatus, byCategory };
  }, [data, now, timeZone, selection.status, selection.categoryIds]);

  const go = (href: string) => router.replace(href, { scroll: false });

  return (
    <nav className="sidebar" aria-label="主菜单">
      <div className="sidebar-brand">
        <span>Alethego</span>
        <ModeToggle />
      </div>

      <section className="sidebar-section" aria-label="状态">
        <ul>
          {STATUS_ORDER.map((status) => {
            const selected = selection.status === status;
            return (
              <li key={status}>
                <Link
                  href={selectionHref({ ...selection, status })}
                  replace
                  scroll={false}
                  className="sidebar-item"
                  aria-current={selected ? 'page' : undefined}
                >
                  <span className={`sidebar-icon sidebar-icon-${status}`} aria-hidden>
                    {STATUS_ICONS[status]}
                  </span>
                  <span className="sidebar-label">{STATUS_LABELS[status]}</span>
                  {counts && <span className="sidebar-count">{counts.byStatus[status]}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="sidebar-section" aria-label="分类">
        <h2 className="sidebar-heading">分类</h2>
        <ul>
          {data?.categories.map((category) => {
            const selected = selection.categoryIds.includes(category.id);
            if (editing === category.id) {
              return (
                <li key={category.id}>
                  <CategoryForm
                    categories={data.categories}
                    category={category}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      await reload();
                    }}
                    onDeleted={async () => {
                      setEditing(null);
                      // 删除已选中的分类时同时把它从选择中去掉
                      if (selected) go(selectionHref(toggleCategory(selection, category.id)));
                      await reload();
                    }}
                  />
                </li>
              );
            }
            return (
              <li key={category.id} className="sidebar-category">
                <button
                  type="button"
                  className="sidebar-item sidebar-toggle"
                  aria-pressed={selected}
                  title={category.description || undefined}
                  onClick={() => go(selectionHref(toggleCategory(selection, category.id)))}
                >
                  <span className="sidebar-icon" aria-hidden>
                    <CategoryDot color={category.color} />
                  </span>
                  <span className="sidebar-label">{category.name}</span>
                  {counts && (
                    <span className="sidebar-count">{counts.byCategory.get(category.id) ?? 0}</span>
                  )}
                </button>
                <IconButton
                  label={`编辑分类「${category.name}」`}
                  className="sidebar-edit"
                  onClick={() => setEditing(category.id)}
                >
                  <PencilIcon size={14} />
                </IconButton>
              </li>
            );
          })}
        </ul>
        {editing === 'new' && data ? (
          <CategoryForm
            categories={data.categories}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reload();
            }}
          />
        ) : (
          <button type="button" className="sidebar-add" onClick={() => setEditing('new')}>
            + 新建分类
          </button>
        )}
      </section>
    </nav>
  );
}
