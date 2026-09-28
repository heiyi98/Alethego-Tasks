'use client';

import { buildTaskList, type ListScope } from '@alethego/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { CategoryDot } from './category-dot';
import { CategoryForm } from './category-form';
import { IconButton, PencilIcon } from './icons';
import { ModeToggle } from './mode-toggle';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { SCOPE_LABELS, SCOPE_ORDER } from '@/lib/format';
import { selectionHref, toggleCategory } from '@/lib/selection';

const SCOPE_ICONS: Record<ListScope, string> = {
  all: '☰',
  starred: '★',
};

/**
 * 左侧菜单：
 * - 上区：总览 / 收藏，单选。总览 = 没有选任何分类，点它会清空分类选择
 * - 下区「分类」：每个分类是一个开关，可多选累加；一个都不选 = 所有分类
 * 状态（全部 / 未完成 / 已完成 / 已错过）不在菜单里，在清单页面内的添加栏下面。
 *
 * 数字：清单模式下按页面当前选中的状态计数（点了之后看到几个就是几个）；
 * 矩阵模式没有状态行，按"未完成"计数。总览不分分类计数，收藏在当前所选分类内计数，
 * 分类项在当前范围内计数。
 */
export function Sidebar() {
  const { data, now, timeZone, reload } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  // 同一时间只打开一个分类表单：'new' = 新建，其他值 = 正在编辑的分类 id
  const [editing, setEditing] = useState<string | null>(null);

  const countStatus = selection.mode === 'list' ? selection.status : 'todo';
  const counts = useMemo(() => {
    if (!data) return null;
    const sources = {
      tasks: data.tasks,
      categoryIdsByTask: data.categoryIdsByTask,
      occurrencesByTask: data.occurrencesByTask,
    };
    const context = { now, timeZone };
    const count = (scope: ListScope, categoryIds: readonly string[]) =>
      buildTaskList(sources, { scope, status: countStatus, categoryIds }, context).length;
    // 总览 = 没有选任何分类；收藏在当前所选分类内计数
    const byScope: Record<ListScope, number> = {
      all: count('all', []),
      starred: count('starred', selection.categoryIds),
    };
    const byCategory = new Map(data.categories.map((c) => [c.id, count(selection.scope, [c.id])]));
    return { byScope, byCategory };
  }, [data, now, timeZone, countStatus, selection.scope, selection.categoryIds]);

  const go = (href: string) => router.replace(href, { scroll: false });

  return (
    <nav className="sidebar" aria-label="主菜单">
      <div className="sidebar-brand">
        <span>Alethego</span>
        <ModeToggle />
      </div>

      <section className="sidebar-section" aria-label="范围">
        <ul>
          {SCOPE_ORDER.map((scope) => {
            // 总览 = 没有选任何分类：点它会清空当前所有分类选择
            const selected =
              selection.scope === scope &&
              (scope === 'starred' || selection.categoryIds.length === 0);
            const target =
              scope === 'all' ? { ...selection, scope, categoryIds: [] } : { ...selection, scope };
            return (
              <li key={scope}>
                <Link
                  href={selectionHref(target)}
                  replace
                  scroll={false}
                  className="sidebar-item"
                  aria-current={selected ? 'page' : undefined}
                >
                  <span className={`sidebar-icon sidebar-icon-${scope}`} aria-hidden>
                    {SCOPE_ICONS[scope]}
                  </span>
                  <span className="sidebar-label">{SCOPE_LABELS[scope]}</span>
                  {counts && <span className="sidebar-count">{counts.byScope[scope]}</span>}
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
