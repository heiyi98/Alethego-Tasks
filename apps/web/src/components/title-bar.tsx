'use client';

import { CONTAINER_FEATURES } from '@alethego/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CategoryDot } from './category-dot';
import { useCurrentGroup } from './current-group';
import { GroupIcon, IconButton, ListIcon, RaciIcon, XIcon } from './icons';
import { RosterDialog } from './roster-dialog';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { selectionHref, toggleCategory } from '@/lib/selection';

/**
 * 页面标题行（所有看法共用），高度固定：不管显示哪些按钮，标题和下面的快速添加栏都不上下移动。
 * - 收藏：只显示"收藏"；没选分类：显示"总览"
 * - 选了分类：每个分类一个胶囊（名字 + ✕）。名字不能点，只有 ✕ 取消选择；放不下时左右滑动
 * - 在组里：组名（不能点）+ 右边的名单按钮（打开名单窗口）；有多种看法的组在最右边放切换按钮
 */
export function TitleBar() {
  const { data } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  const { group } = useCurrentGroup();
  const [rosterOpen, setRosterOpen] = useState(false);

  const go = (href: string) => router.replace(href, { scroll: false });

  if (selection.groupId) {
    const views = group ? CONTAINER_FEATURES[group.kind].views : [];
    const nextView = selection.mode === 'raci' ? 'list' : 'raci';
    return (
      <header className="page-header">
        <div className="title-row">
          <h1 className="title-bar">
            {group && <span className="title-bar-text">{group.name}</span>}
          </h1>
          {group && (
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
          {group && views.includes('raci') && (
            <Link
              href={selectionHref({ ...selection, mode: nextView })}
              replace
              scroll={false}
              className="icon-button view-toggle"
              aria-label={nextView === 'raci' ? '切换到责任分配矩阵' : '切换到清单'}
            >
              {nextView === 'raci' ? <RaciIcon /> : <ListIcon />}
            </Link>
          )}
        </div>
        {group && rosterOpen && <RosterDialog group={group} onClose={() => setRosterOpen(false)} />}
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
      </div>
    </header>
  );
}
