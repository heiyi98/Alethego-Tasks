'use client';

import { buildTaskList, type ListScope } from '@alethego/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { AccountMenu, useCurrentUser } from '@/auth';
import { CategoryDot } from './category-dot';
import { CategoryForm } from './category-form';
import { GroupSection } from './sidebar-groups';
import { ChevronDownIcon, IconButton, PencilIcon } from './icons';
import { MatrixFilterBar } from './matrix-filter-bar';
import { ModeToggle } from './mode-toggle';
import { NotificationBell } from './notifications';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { SCOPE_LABELS, SCOPE_ORDER } from '@/lib/format';
import { relatedGroupTaskPredicate } from '@/lib/related';
import { categoryHref, isCurrentPage, scopeHref } from '@/lib/selection';

const SCOPE_ICONS: Record<ListScope, string> = {
  all: '☰',
  today: '◷',
  starred: '★',
};

/** 折叠状态只是本机的便利设置，读不到就展开 */
const PERSONAL_COLLAPSED_KEY = 'alethego.personal-collapsed';

/**
 * 左侧菜单（清单）：单选导航，每一项点下去就是一个页面，当前页面整行高亮。从上到下：
 * - 总览（我所有的个人任务）、今日、收藏
 * - 「个人」分区（可以收起）：个人分类，点一个分类就是这个分类的任务
 * - 「组」分区（可以收起）：各个组（这个组里我能看到的所有项目的任务），组下面是项目
 * - 最下面：账号 + 通知
 * 进入时间管理矩阵后换成筛选栏（见 MatrixFilterBar）。
 * 状态（全部 / 未完成 / 已完成 / 已错过）不在菜单里，在清单页面内的添加栏下面。
 * 数字：按页面当前选中的状态计数（点了之后看到几个就是几个）。
 */
export function Sidebar() {
  const selection = useSelection();
  if (selection.mode === 'matrix') return <MatrixFilterBar />;
  return <ListSidebar />;
}

function ListSidebar() {
  const { data, now, timeZone, reload } = useTaskData();
  const user = useCurrentUser();
  const selection = useSelection();
  const router = useRouter();
  // 同一时间只打开一个分类表单：'new' = 新建，其他值 = 正在编辑的分类 id
  const [editing, setEditing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(PERSONAL_COLLAPSED_KEY) === '1');
    } catch {
      // 读不到就展开
    }
  }, []);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(PERSONAL_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // 存不了就算了
    }
  };

  const countStatus = selection.status;
  const counts = useMemo(() => {
    if (!data) return null;
    const sources = {
      tasks: data.tasks,
      categoryIdsByTask: data.categoryIdsByTask,
      occurrencesByTask: data.occurrencesByTask,
    };
    const context = { now, timeZone };
    const isRelated = relatedGroupTaskPredicate(data, user.id);
    // 个人的页面没有"待确认"：按"未完成"计数
    const personalStatus = countStatus === 'pending' ? 'todo' : countStatus;
    const count = (scope: ListScope, categoryIds: readonly string[]) =>
      buildTaskList(
        sources,
        {
          scope,
          status: scope === 'today' ? countStatus : personalStatus,
          categoryIds,
          isRelatedGroupTask: isRelated,
        },
        context,
      ).length;
    const byScope: Record<ListScope, number> = {
      all: count('all', []),
      today: count('today', []),
      starred: count('starred', []),
    };
    const byCategory = new Map(data.categories.map((c) => [c.id, count('all', [c.id])]));
    const countIn = (groupId: string, projectId: string | null = null) =>
      buildTaskList(
        sources,
        { scope: 'all', status: countStatus, categoryIds: [], groupId, projectId },
        context,
      ).length;
    const byGroup = new Map(data.groups.map((g) => [g.id, countIn(g.id)]));
    const byProject = new Map(data.projects.map((p) => [p.id, countIn(p.groupId, p.id)]));
    return { byScope, byCategory, byGroup, byProject };
  }, [data, now, timeZone, countStatus, user.id]);

  const go = (href: string) => router.replace(href, { scroll: false });

  return (
    <nav className="sidebar" aria-label="主菜单">
      {/* 上面的内容可以滚动；最下面的账号和通知固定在左下角，展开的内容都从它们上方弹出 */}
      <div className="sidebar-scroll">
        <div className="sidebar-brand">
          <span>Alethego</span>
          <ModeToggle />
        </div>

        <section className="sidebar-section" aria-label="范围">
          <ul>
            {SCOPE_ORDER.map((scope) => (
              <li key={scope}>
                <Link
                  href={scopeHref(selection, scope)}
                  replace
                  scroll={false}
                  className="sidebar-item"
                  aria-current={
                    isCurrentPage(selection, { kind: 'scope', scope }) ? 'page' : undefined
                  }
                >
                  <span className={`sidebar-icon sidebar-icon-${scope}`} aria-hidden>
                    {SCOPE_ICONS[scope]}
                  </span>
                  <span className="sidebar-label">{SCOPE_LABELS[scope]}</span>
                  {counts && <span className="sidebar-count">{counts.byScope[scope]}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="sidebar-section" aria-label="个人">
          <h2 className="sidebar-heading">
            <button
              type="button"
              className="sidebar-heading-toggle"
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
            >
              个人
              <ChevronDownIcon size={12} />
            </button>
          </h2>
          {!collapsed && (
            <>
              <ul>
                {data?.categories.map((category) => {
                  const selected = isCurrentPage(selection, { kind: 'category', id: category.id });
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
                            // 删除的正是当前页面的分类：回到总览
                            if (selected) go(scopeHref(selection, 'all'));
                            await reload();
                          }}
                        />
                      </li>
                    );
                  }
                  return (
                    <li key={category.id} className="sidebar-category">
                      <Link
                        href={categoryHref(selection, category.id)}
                        replace
                        scroll={false}
                        className="sidebar-item sidebar-toggle"
                        aria-current={selected ? 'page' : undefined}
                      >
                        <span className="sidebar-icon" aria-hidden>
                          <CategoryDot color={category.color} />
                        </span>
                        <span className="sidebar-label">{category.name}</span>
                        {counts && (
                          <span className="sidebar-count">
                            {counts.byCategory.get(category.id) ?? 0}
                          </span>
                        )}
                      </Link>
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
            </>
          )}
        </section>

        <GroupSection counts={counts} />
      </div>
      <div className="sidebar-bottom">
        <AccountMenu />
        <NotificationBell />
      </div>
    </nav>
  );
}
