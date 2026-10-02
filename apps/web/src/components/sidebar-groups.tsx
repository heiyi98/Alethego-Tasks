'use client';

import type { Group } from '@alethego/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { CategoryDot } from './category-dot';
import { EditGroupForm, NewGroupForm } from './group-form';
import { ChevronDownIcon, GroupIcon, IconButton, PencilIcon } from './icons';
import { EditProjectForm, NewProjectForm } from './project-form';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { groupHref } from '@/lib/selection';

/** 折叠状态只是本机的便利设置，读不到就展开 */
const COLLAPSED_KEY = 'alethego.groups-collapsed';
const COLLAPSED_GROUPS_KEY = 'alethego.collapsed-groups';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存不了就算了
  }
}

/**
 * 侧边栏的「组」区：我能看到的每个组（组名前是组的颜色），组下面缩进列出我能看到的项目；
 * 每个组可以展开 / 收起，整个区也可以折叠。组长在组下面有"新建项目"。
 * 组旁边的铅笔打开和分类一样的原地表单（组名和颜色、我在本组的昵称、删除组）；
 * 项目旁边的铅笔（组长）：项目名和颜色、删除项目。
 */
export function GroupSection({
  counts,
}: {
  counts: { byGroup: Map<string, number>; byProject: Map<string, number> } | null;
}) {
  const { data, reload } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // 同一时间只打开一个表单：'new' = 新建组，'project:<组 id>' = 新建项目，其他值 = 正在编辑的组 / 项目 id
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    setCollapsed(readStored(COLLAPSED_KEY) === '1');
    setCollapsedGroups(
      new Set((readStored(COLLAPSED_GROUPS_KEY) ?? '').split(',').filter(Boolean)),
    );
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    store(COLLAPSED_KEY, next ? '1' : '0');
  }

  function toggleGroup(groupId: string) {
    const next = new Set(collapsedGroups);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setCollapsedGroups(next);
    store(COLLAPSED_GROUPS_KEY, [...next].join(','));
  }

  const inThisGroup = (group: Group) => selection.groupId === group.id;

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
            {data?.groups.map((group) => {
              const projects = data.projects.filter((p) => p.groupId === group.id);
              const expanded = !collapsedGroups.has(group.id);
              const leader = group.myRole === 'leader';
              return (
                <li key={group.id} className="sidebar-group" data-group-id={group.id}>
                  {editing === group.id ? (
                    <EditGroupForm
                      group={group}
                      onCancel={() => setEditing(null)}
                      onSaved={async () => {
                        setEditing(null);
                        await reload();
                      }}
                      onDeleted={async () => {
                        setEditing(null);
                        if (inThisGroup(group)) router.replace('/', { scroll: false });
                        await reload();
                      }}
                    />
                  ) : (
                    <div className="sidebar-category sidebar-group-row">
                      <button
                        type="button"
                        className="sidebar-group-expand"
                        aria-label={`${expanded ? '收起' : '展开'}「${group.name}」`}
                        aria-expanded={expanded}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <ChevronDownIcon size={12} />
                      </button>
                      <Link
                        href={groupHref(selection, group.id)}
                        replace
                        scroll={false}
                        className="sidebar-item sidebar-toggle"
                        aria-current={
                          inThisGroup(group) && !selection.projectId ? 'page' : undefined
                        }
                      >
                        <span className="sidebar-icon" aria-hidden>
                          {group.color ? (
                            <CategoryDot color={group.color} />
                          ) : (
                            <GroupIcon size={15} />
                          )}
                        </span>
                        <span className="sidebar-label">{group.name}</span>
                        {counts && (
                          <span className="sidebar-count">{counts.byGroup.get(group.id) ?? 0}</span>
                        )}
                      </Link>
                      {/* 只在项目里的人：没有组的设置可改 */}
                      {group.myRole && (
                        <IconButton
                          label={`编辑组「${group.name}」`}
                          className="sidebar-edit"
                          onClick={() => setEditing(group.id)}
                        >
                          <PencilIcon size={14} />
                        </IconButton>
                      )}
                    </div>
                  )}
                  {expanded && (
                    <ul className="sidebar-projects" aria-label={`「${group.name}」的项目`}>
                      {projects.map((project) =>
                        editing === project.id ? (
                          <li key={project.id}>
                            <EditProjectForm
                              project={project}
                              onCancel={() => setEditing(null)}
                              onSaved={async () => {
                                setEditing(null);
                                await reload();
                              }}
                              onDeleted={async () => {
                                setEditing(null);
                                if (selection.projectId === project.id) {
                                  router.replace(groupHref(selection, group.id), { scroll: false });
                                }
                                await reload();
                              }}
                            />
                          </li>
                        ) : (
                          <li key={project.id} className="sidebar-category">
                            <Link
                              href={groupHref(selection, group.id, project.id)}
                              replace
                              scroll={false}
                              className="sidebar-item sidebar-toggle"
                              aria-current={selection.projectId === project.id ? 'page' : undefined}
                            >
                              <span className="sidebar-icon" aria-hidden>
                                <CategoryDot color={project.color} />
                              </span>
                              <span className="sidebar-label">{project.name}</span>
                              {counts && (
                                <span className="sidebar-count">
                                  {counts.byProject.get(project.id) ?? 0}
                                </span>
                              )}
                            </Link>
                            {project.myRole === 'leader' && (
                              <IconButton
                                label={`编辑项目「${project.name}」`}
                                className="sidebar-edit"
                                onClick={() => setEditing(project.id)}
                              >
                                <PencilIcon size={14} />
                              </IconButton>
                            )}
                          </li>
                        ),
                      )}
                      {leader &&
                        (editing === `project:${group.id}` ? (
                          <li>
                            <NewProjectForm
                              group={group}
                              projects={projects}
                              onCancel={() => setEditing(null)}
                              onCreated={async (project) => {
                                setEditing(null);
                                await reload();
                                router.replace(groupHref(selection, group.id, project.id), {
                                  scroll: false,
                                });
                              }}
                            />
                          </li>
                        ) : (
                          <li>
                            <button
                              type="button"
                              className="sidebar-add"
                              onClick={() => setEditing(`project:${group.id}`)}
                            >
                              + 新建项目
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              );
            })}
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
