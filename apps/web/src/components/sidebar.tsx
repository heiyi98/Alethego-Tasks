'use client';

import { buildTaskList, type StatusFilter } from '@alethego/core';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { CategoryCreateForm } from './category-create-form';
import { CategoryDot } from './category-dot';
import { useTaskData } from './task-data-provider';
import { STATUS_LABELS, STATUS_ORDER } from '@/lib/format';

const STATUS_ICONS: Record<StatusFilter, string> = {
  all: '☰',
  todo: '○',
  completed: '✓',
  missed: '!',
};

/**
 * 左侧菜单：
 * - 总览：以状态为主导航（全部 / 未完成 / 已完成 / 已错过），页面内再用分类标签筛选
 * - 分类：以分类为主导航，页面内再用状态标签筛选
 * 两个区块背后是同一份数据与同一套筛选逻辑（buildTaskList）。
 */
export function Sidebar() {
  const { data, now, timeZone, reload } = useTaskData();
  const pathname = usePathname();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    if (!data) return null;
    const sources = {
      tasks: data.tasks,
      categoryIdsByTask: data.categoryIdsByTask,
      occurrencesByTask: data.occurrencesByTask,
    };
    const context = { now, timeZone };
    const byStatus = Object.fromEntries(
      STATUS_ORDER.map((status) => [
        status,
        buildTaskList(sources, { status, categoryIds: [] }, context).length,
      ]),
    ) as Record<StatusFilter, number>;
    // 分类项显示该分类下未完成的任务数
    const byCategory = new Map(
      data.categories.map((c) => [
        c.id,
        buildTaskList(sources, { status: 'todo', categoryIds: [c.id] }, context).length,
      ]),
    );
    return { byStatus, byCategory };
  }, [data, now, timeZone]);

  return (
    <nav className="sidebar" aria-label="主菜单">
      <div className="sidebar-brand">Alethego</div>

      <section className="sidebar-section" aria-label="总览">
        <h2 className="sidebar-heading">总览</h2>
        <ul>
          {STATUS_ORDER.map((status) => {
            const href = `/list/${status}`;
            return (
              <li key={status}>
                <Link
                  href={href}
                  className="sidebar-item"
                  aria-current={pathname === href ? 'page' : undefined}
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
            const href = `/category/${category.id}`;
            return (
              <li key={category.id}>
                <Link
                  href={href}
                  className="sidebar-item"
                  aria-current={pathname === href ? 'page' : undefined}
                >
                  <span className="sidebar-icon" aria-hidden>
                    <CategoryDot color={category.color} />
                  </span>
                  <span className="sidebar-label">{category.name}</span>
                  {counts && (
                    <span className="sidebar-count">{counts.byCategory.get(category.id) ?? 0}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        {creating && data ? (
          <CategoryCreateForm
            categories={data.categories}
            onCancel={() => setCreating(false)}
            onCreated={async (category) => {
              setCreating(false);
              await reload();
              router.push(`/category/${category.id}`);
            }}
          />
        ) : (
          <button type="button" className="sidebar-add" onClick={() => setCreating(true)}>
            + 新建分类
          </button>
        )}
      </section>

      <div className="sidebar-footer">
        <Link
          href="/matrix"
          className="sidebar-item"
          aria-current={pathname === '/matrix' ? 'page' : undefined}
        >
          <span className="sidebar-icon" aria-hidden>
            ⊞
          </span>
          <span className="sidebar-label">时间管理矩阵</span>
        </Link>
      </div>
    </nav>
  );
}
