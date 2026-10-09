'use client';

import type { TaskView } from '@alethego/core';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { useCurrentGroup } from './current-group';
import { GanttIcon, GroupIcon, IconButton, ListIcon, RaciIcon } from './icons';
import { GroupRosterDialog, ProjectRosterDialog } from './roster-dialog';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { SCOPE_LABELS } from '@/lib/format';
import { selectionHref, withMode } from '@/lib/selection';

/**
 * 页面标题行（所有看法共用），高度固定：不管显示哪些按钮，标题和下面的快速添加栏都不上下移动。
 * 标题就是侧边栏所选那一项的名字：总览 / 今日 / 收藏 / 分类名 / 组名 / 项目名。
 * - 在组里：组名 + 右边的组名单按钮（只在项目里的人没有）
 * - 在项目里：项目名 + 右边的项目名单按钮；最右边是看法的切换（清单、责任分配矩阵、甘特图，按工具箱）
 * - 个人分类开了任务关系：最右边是清单 / 甘特图的切换
 */
export function TitleBar() {
  const { data } = useTaskData();
  const selection = useSelection();
  const { group, project, features, permissions } = useCurrentGroup();
  const [rosterOpen, setRosterOpen] = useState(false);

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

  // 个人：标题就是所选那一项的名字（总览 / 今日 / 收藏 / 分类名）
  const category = selection.categoryIds[0]
    ? data?.categories.find((c) => c.id === selection.categoryIds[0])
    : undefined;
  const title = category ? category.name : SCOPE_LABELS[selection.scope];
  return (
    <header className="page-header">
      <div className="title-row">
        <h1 className="title-bar">
          <span className="title-bar-text">{title}</span>
        </h1>
        <span className="spacer" />
        {category && <ViewSwitch views={features.views} />}
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
          href={selectionHref(withMode(selection, view))}
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
