import { describe, expect, it } from 'vitest';

import {
  EMPTY_REGISTRY,
  REGISTRY_KEY,
  defaultDisplayName,
  loadRegistry,
  removeAccount,
  saveRegistry,
  sessionStorageKey,
  switchActive,
  upsertAccount,
  type KeyValueStorage,
} from './accounts';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const a = { id: 'a', email: 'a@example.com', displayName: 'A' };
const b = { id: 'b', email: 'b@example.com', displayName: 'B' };

describe('这台设备上的账号列表', () => {
  it('加入账号并设为当前；同一账号再登录只更新不重复', () => {
    let r = upsertAccount(EMPTY_REGISTRY, a);
    r = upsertAccount(r, b);
    expect(r).toEqual({ activeId: 'b', accounts: [a, b] });
    r = upsertAccount(r, { ...a, displayName: 'A2' });
    expect(r.activeId).toBe('a');
    expect(r.accounts.map((x) => x.displayName)).toEqual(['A2', 'B']);
  });

  it('切换当前账号；不在列表里的账号不能切换', () => {
    const r = upsertAccount(upsertAccount(EMPTY_REGISTRY, a), b);
    expect(switchActive(r, 'a').activeId).toBe('a');
    expect(switchActive(r, 'x')).toBe(r);
  });

  it('去掉当前账号时改用剩下的第一个；都去掉后没有当前账号', () => {
    let r = upsertAccount(upsertAccount(EMPTY_REGISTRY, a), b);
    r = removeAccount(r, 'b');
    expect(r).toEqual({ activeId: 'a', accounts: [a] });
    expect(removeAccount(r, 'a')).toEqual(EMPTY_REGISTRY);
  });

  it('存进本机、读回来一样；数据损坏时当作没有账号', () => {
    const storage = memoryStorage();
    const r = upsertAccount(upsertAccount(EMPTY_REGISTRY, a), b);
    saveRegistry(storage, r);
    expect(loadRegistry(storage)).toEqual(r);
    storage.setItem(REGISTRY_KEY, '{oops');
    expect(loadRegistry(storage)).toEqual(EMPTY_REGISTRY);
    storage.setItem(REGISTRY_KEY, JSON.stringify({ activeId: 'zz', accounts: [a] }));
    expect(loadRegistry(storage)).toEqual({ activeId: null, accounts: [a] });
  });

  it('每个账号的会话各存一个键', () => {
    expect(sessionStorageKey('a')).not.toBe(sessionStorageKey('b'));
  });
});

describe('名字的默认值', () => {
  it('优先用 Alethego 登录信息里的名字（Google 登录会有）', () => {
    expect(
      defaultDisplayName({ email: 'x@example.com', user_metadata: { full_name: ' 张三 ' } }),
    ).toBe('张三');
    expect(defaultDisplayName({ email: 'x@example.com', user_metadata: { name: 'Li' } })).toBe(
      'Li',
    );
  });

  it('没有名字就用邮箱 @ 前面那一段', () => {
    expect(defaultDisplayName({ email: 'hello.world@example.com', user_metadata: {} })).toBe(
      'hello.world',
    );
  });
});
