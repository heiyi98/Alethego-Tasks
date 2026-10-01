'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { CategoryDot } from './category-dot';
import { EditGroupForm, NewGroupForm } from './group-form';
import { ChevronDownIcon, GroupIcon, IconButton, PencilIcon } from './icons';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { groupHref } from '@/lib/selection';

/** 折叠状态只是本机的便利设置，读不到就展开 */
const COLLAPSED_KEY = 'alethego.groups-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // 存不了就算了
  }
}

/**
 * 侧边栏的「组」区：我所在的每个组（组名前是组的颜色）+ 新建组；可以折叠。
 * 每个组旁边的铅笔打开和分类一样的原地表单（组名和颜色、我在本组的昵称、删除组）。
 */
export function GroupSection({ counts }: { counts: Map<string, number> | null }) {
  const { data, reload } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  // 同一时间只打开一个表单：'new' = 新建，其他值 = 正在编辑的组 id
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => setCollapsed(readCollapsed()), []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    storeCollapsed(next);
  }

  return (
    <section className="sidebar-section sidebar-groups" aria-label="组">
      <h2 className="sidebar-heading">
        <button
          type="button"
          className="sidebar-heading-toggle"
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          组
          <ChevronDownIcon size={12} />
        </button>
      </h2>
      {!collapsed && (
        <>
          <ul>
            {data?.groups.map((group) =>
              editing === group.id ? (
                <li key={group.id}>
                  <EditGroupForm
                    group={group}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      await reload();
                    }}
                    onDeleted={async () => {
                      setEditing(null);
                      if (selection.groupId === group.id) router.replace('/', { scroll: false });
                      await reload();
                    }}
                  />
                </li>
              ) : (
                <li key={group.id} className="sidebar-category">
                  <Link
                    href={groupHref(selection, group.id)}
                    replace
                    scroll={false}
                    className="sidebar-item sidebar-toggle"
                    aria-current={selection.groupId === group.id ? 'page' : undefined}
                  >
                    <span className="sidebar-icon" aria-hidden>
                      {group.color ? <CategoryDot color={group.color} /> : <GroupIcon size={15} />}
                    </span>
                    <span className="sidebar-label">{group.name}</span>
                    {counts && <span className="sidebar-count">{counts.get(group.id) ?? 0}</span>}
                  </Link>
                  <IconButton
                    label={`编辑组「${group.name}」`}
                    className="sidebar-edit"
                    onClick={() => setEditing(group.id)}
                  >
                    <PencilIcon size={14} />
                  </IconButton>
                </li>
              ),
            )}
          </ul>
          {editing === 'new' && data ? (
            <NewGroupForm
              groups={data.groups}
              onCancel={() => setEditing(null)}
              onCreated={async (group) => {
                setEditing(null);
                await reload();
                router.replace(groupHref(selection, group.id), { scroll: false });
              }}
            />
          ) : (
            <button type="button" className="sidebar-add" onClick={() => setEditing('new')}>
              + 新建组
            </button>
          )}
        </>
      )}
    </section>
  );
}
