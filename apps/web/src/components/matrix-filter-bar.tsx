'use client';

import {
  categoryChecked,
  groupState,
  personalState,
  projectChecked,
  toggleCategory,
  toggleGroup,
  togglePersonal,
  toggleProject,
  type CheckState,
} from '@alethego/core';
import { useEffect, useMemo, useRef } from 'react';

import { AccountMenu } from '@/auth';
import { CategoryDot } from './category-dot';
import { GroupIcon } from './icons';
import { useMatrixFilter } from './matrix-filter';
import { ModeToggle } from './mode-toggle';
import { NotificationBell } from './notifications';
import { useTaskData } from './task-data-provider';

/**
 * 时间管理矩阵的筛选栏（进入矩阵后替换左边的侧边栏）：
 * "个人"和个人分类，"组"分区下的各个组和项目，每一行前面一个勾选框，可以多选；
 * 矩阵显示所有勾选内容的并集。和清单侧边栏（点一行、整行高亮）的区别靠形态体现，不加文字说明。
 */
export function MatrixFilterBar() {
  const { data } = useTaskData();
  const { filter, setFilter } = useMatrixFilter();
  const tree = useMemo(
    () => ({
      categoryIds: data?.categories.map((c) => c.id) ?? [],
      groups:
        data?.groups.map((g) => ({
          id: g.id,
          projectIds: data.projects.filter((p) => p.groupId === g.id).map((p) => p.id),
        })) ?? [],
    }),
    [data],
  );

  return (
    <nav className="sidebar matrix-filter-bar" aria-label="矩阵筛选">
      <div className="sidebar-scroll">
        <div className="sidebar-brand">
          <span>Alethego</span>
          <ModeToggle />
        </div>

        <section className="sidebar-section" aria-label="个人">
          <ul>
            <li>
              <CheckRow
                label="个人"
                state={personalState(filter, tree)}
                onToggle={() => setFilter(togglePersonal(filter, tree))}
                heading
              />
            </li>
            {data?.categories.map((category) => (
              <li key={category.id} className="filter-child">
                <CheckRow
                  label={category.name}
                  icon={<CategoryDot color={category.color} />}
                  state={categoryChecked(filter, category.id) ? 'checked' : 'unchecked'}
                  onToggle={() => setFilter(toggleCategory(filter, tree, category.id))}
                />
              </li>
            ))}
          </ul>
        </section>

        {data && data.groups.length > 0 && (
          <section className="sidebar-section" aria-label="组">
            <h2 className="sidebar-heading">组</h2>
            <ul>
              {data.groups.map((group) => {
                const node = tree.groups.find((g) => g.id === group.id)!;
                return (
                  <li key={group.id}>
                    <CheckRow
                      label={group.name}
                      icon={
                        group.color ? <CategoryDot color={group.color} /> : <GroupIcon size={15} />
                      }
                      state={groupState(filter, node)}
                      onToggle={() => setFilter(toggleGroup(filter, node))}
                    />
                    <ul className="sidebar-projects" aria-label={`「${group.name}」的项目`}>
                      {data.projects
                        .filter((p) => p.groupId === group.id)
                        .map((project) => (
                          <li key={project.id} className="filter-child">
                            <CheckRow
                              label={project.name}
                              icon={<CategoryDot color={project.color} />}
                              state={
                                projectChecked(filter, group.id, project.id)
                                  ? 'checked'
                                  : 'unchecked'
                              }
                              onToggle={() => setFilter(toggleProject(filter, node, project.id))}
                            />
                          </li>
                        ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
      <div className="sidebar-bottom">
        <AccountMenu />
        <NotificationBell />
      </div>
    </nav>
  );
}

/** 一行：勾选框 + 名字；部分选中时勾选框显示"部分选中" */
function CheckRow({
  label,
  icon,
  state,
  onToggle,
  heading = false,
}: {
  label: string;
  icon?: React.ReactNode;
  state: CheckState;
  onToggle: () => void;
  heading?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'partial';
  }, [state]);
  return (
    <label className={`filter-row${heading ? ' filter-row-heading' : ''}`}>
      <input
        ref={ref}
        type="checkbox"
        className="filter-check"
        checked={state === 'checked'}
        aria-checked={state === 'partial' ? 'mixed' : state === 'checked'}
        onChange={onToggle}
      />
      {icon && (
        <span className="sidebar-icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="sidebar-label">{label}</span>
    </label>
  );
}
