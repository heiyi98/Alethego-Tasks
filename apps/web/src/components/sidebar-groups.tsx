'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type KeyboardEvent } from 'react';

import { ChevronDownIcon, GroupIcon } from './icons';
import { useRepositories } from './repositories-provider';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { errorMessage } from '@/lib/format';
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

/** 侧边栏的「组」区：我所在的每个组 + 新建组；可以折叠 */
export function GroupSection({ counts }: { counts: Map<string, number> | null }) {
  const { data, reload } = useTaskData();
  const repositories = useRepositories();
  const selection = useSelection();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setCollapsed(readCollapsed()), []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    storeCollapsed(next);
  }

  function cancel() {
    setCreating(false);
    setName('');
    setError(null);
  }

  async function create() {
    const value = name.trim();
    if (!value) {
      setError('组名不能为空');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const group = await repositories.groups.create(value);
      cancel();
      await reload();
      router.replace(groupHref(selection, group.id), { scroll: false });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void create();
    } else if (event.key === 'Escape') {
      cancel();
    }
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
            {data?.groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={groupHref(selection, group.id)}
                  replace
                  scroll={false}
                  className="sidebar-item"
                  aria-current={selection.groupId === group.id ? 'page' : undefined}
                >
                  <span className="sidebar-icon" aria-hidden>
                    <GroupIcon size={15} />
                  </span>
                  <span className="sidebar-label">{group.name}</span>
                  {counts && <span className="sidebar-count">{counts.get(group.id) ?? 0}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {creating ? (
            <div className="group-create" role="form" aria-label="新建组">
              <input
                aria-label="组名"
                placeholder="组名"
                value={name}
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                onKeyDown={onKeyDown}
              />
              {error && <p className="field-error">{error}</p>}
              <div className="category-form-actions">
                <button type="button" className="button-link" onClick={cancel}>
                  取消
                </button>
                <button
                  type="button"
                  className="button-primary button-small"
                  disabled={busy}
                  onClick={() => void create()}
                >
                  创建
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="sidebar-add" onClick={() => setCreating(true)}>
              + 新建组
            </button>
          )}
        </>
      )}
    </section>
  );
}
