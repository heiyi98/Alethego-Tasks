'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useAccounts } from './auth-provider';

/**
 * 账号菜单（侧边栏最下面）：显示当前账号的名字，点它展开：
 * - 这台设备上登录过的所有账号，点哪个切换到哪个（不需要再输密码）
 * - 当前账号的名字点开原地编辑（和任务标题的编辑方式一样），保存到 taskapp.users.display_name
 * - 添加账号：进入登录页，登录后加入列表
 * - 退出：退出这台设备上的所有账号，回到登录页
 */
export function AccountMenu() {
  const { currentUser, accounts, switchTo, addAccount, signOutAll, rename } = useAccounts();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentUser.displayName);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function save() {
    const name = draft.trim();
    if (!name) {
      setError('名字不能为空');
      return;
    }
    setEditing(false);
    setError(null);
    if (name === currentUser.displayName) return;
    try {
      await rename(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      setDraft(currentUser.displayName);
      setEditing(false);
      setError(null);
    }
  }

  return (
    <section className="account-menu" aria-label="账号">
      <button
        type="button"
        className="sidebar-item account-current"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setEditing(false);
          setError(null);
        }}
      >
        <span className="sidebar-label">{currentUser.displayName}</span>
      </button>

      {open && (
        <div className="account-panel">
          <ul className="account-list" aria-label="这台设备上的账号">
            {accounts.map((account) =>
              account.id === currentUser.id ? (
                <li key={account.id} className="account-row account-row-current">
                  {editing ? (
                    <input
                      ref={inputRef}
                      className="task-title-input account-name-input"
                      aria-label="名字"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={onKeyDown}
                      onBlur={() => void save()}
                    />
                  ) : (
                    <button
                      type="button"
                      className="account-name"
                      onClick={() => {
                        setDraft(currentUser.displayName);
                        setEditing(true);
                      }}
                    >
                      {currentUser.displayName}
                    </button>
                  )}
                  {currentUser.email && <span className="account-email">{currentUser.email}</span>}
                  {error && (
                    <span className="field-error" role="alert">
                      {error}
                    </span>
                  )}
                </li>
              ) : (
                <li key={account.id} className="account-row">
                  <button
                    type="button"
                    className="account-switch"
                    aria-label={`切换到「${account.displayName}」`}
                    onClick={() => void switchTo(account.id)}
                  >
                    <span className="account-name">{account.displayName}</span>
                    {account.email && <span className="account-email">{account.email}</span>}
                  </button>
                </li>
              ),
            )}
          </ul>
          <button type="button" className="sidebar-item" onClick={addAccount}>
            添加账号
          </button>
          <button type="button" className="sidebar-item" onClick={() => void signOutAll()}>
            退出
          </button>
        </div>
      )}
    </section>
  );
}
