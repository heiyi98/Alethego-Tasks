'use client';

import type { TaskView } from '@alethego/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { CategoryDot } from './category-dot';
import { useCurrentGroup } from './current-group';
import { GanttIcon, GroupIcon, IconButton, ListIcon, RaciIcon, XIcon } from './icons';
import { GroupRosterDialog, ProjectRosterDialog } from './roster-dialog';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { selectionHref, toggleCategory } from '@/lib/selection';

/**
 * 页面标题行（所有看法共用），高度固定：不管显示哪些按钮，标题和下面的快速添加栏都不上下移动。
 * - 收藏：只显示"收藏"；没选分类：显示"总览"
 * - 选了分类：每个分类一个胶囊（名字 + ✕）。名字不能点，只有 ✕ 取消选择；放不下时左右滑动
 * - 在组里：组名（不能点）+ 右边的组名单按钮（只在项目里的人没有）
 * - 在项目里：项目名 + 右边的项目名单按钮；最右边是看法的切换（清单、责任分配矩阵、甘特图，按工具箱）
 * - 个人只选中一个开了任务关系的分类时：最右边是清单 / 甘特图的切换
 */
export function TitleBar() {
  const { data } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  const { group, project, features, permissions } = useCurrentGroup();
  const [rosterOpen, setRosterOpen] = useState(false);

  const go = (href: string) => router.replace(href, { scroll: false });

  if (selection.groupId) {
    const showRoster = Boolean(group && (project || permissions?.viewRoster));
    return (
      <header className="page-header">
        <div className="title-row">
          <h1 className="title-bar">
            {group && <span className="title-bar-text">{project ? project.name : group.name}</span>}
          </h1>
          {showRoster && (
            <IconButton
              label="名单"
              className="title-roster"
              aria-haspopup="dialog"
              onClick={() => setRosterOpen(true)}
            >
              <GroupIcon />
            </IconButton>
          )}
          <span className="spacer" />
          {project && <ViewSwitch views={features.views} />}
        </div>
        {group &&
          rosterOpen &&
          (project ? (
            <ProjectRosterDialog
              group={group}
              project={project}
              onClose={() => setRosterOpen(false)}
            />
          ) : (
            <GroupRosterDialog group={group} onClose={() => setRosterOpen(false)} />
          ))}
      </header>
    );
  }

  const categories = selection.categoryIds
    .map((id) => data?.categories.find((c) => c.id === id))
    .filter((c) => c !== undefined);

  if (selection.scope === 'starred' || categories.length === 0) {
    return (
      <header className="page-header">
        <div className="title-row">
          <h1 className="title-bar">
            <span className="title-bar-text">
              {selection.scope === 'starred' ? '收藏' : '总览'}
            </span>
          </h1>
        </div>
      </header>
    );
  }

  return (
    <header className="page-header">
      <div className="title-row">
        <h1
          className="title-bar title-bar-capsules"
          aria-label={categories.map((c) => c.name).join('、')}
        >
          {categories.map((category) => (
            <span key={category.id} className="title-capsule" data-testid="title-capsule">
              <span className="title-capsule-name">
                <CategoryDot color={category.color} />
                {category.name}
              </span>
              <IconButton
                label={`取消选择「${category.name}」`}
                className="title-capsule-remove"
                onClick={() => go(selectionHref(toggleCategory(selection, category.id)))}
              >
                <XIcon size={14} />
              </IconButton>
            </span>
          ))}
        </h1>
        <ViewSwitch views={features.views} />
      </div>
    </header>
  );
}

const VIEW_SWITCH: Partial<Record<TaskView, { label: string; icon: ReactNode }>> = {
  list: { label: '切换到清单', icon: <ListIcon /> },
  raci: { label: '切换到责任分配矩阵', icon: <RaciIcon /> },
  gantt: { label: '切换到甘特图', icon: <GanttIcon /> },
};

/** 标题行最右边的看法切换：当前容器有两种以上的看法时出现（时间管理矩阵在侧边栏切换，不在这里） */
function ViewSwitch({ views }: { views: readonly TaskView[] }) {
  const selection = useSelection();
  const shown = views.filter((v) => VIEW_SWITCH[v]);
  if (shown.length < 2 || (selection.mode !== 'list' && !shown.includes(selection.mode))) {
    return null;
  }
  return (
    <div className="view-switch" role="group" aria-label="看法">
      {shown.map((view) => (
        <Link
          key={view}
          href={selectionHref({ ...selection, mode: view })}
          replace
          scroll={false}
          className="icon-button view-toggle"
          aria-label={VIEW_SWITCH[view]!.label}
          aria-current={selection.mode === view ? 'page' : undefined}
        >
          {VIEW_SWITCH[view]!.icon}
        </Link>
      ))}
    </div>
  );
}
