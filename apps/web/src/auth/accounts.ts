/**
 * 这台设备上登录过的 Alethego 账号列表（只存在本机浏览器里）。
 *
 * 每个账号的会话由 supabase-js 各自保存在一个独立的存储键下（见 sessionStorageKey），
 * 因此可以在账号之间切换而不需要重新输入密码；这里只记录"有哪些账号、当前是哪个"
 * 以及账号菜单里显示用的名字缓存。
 */

export interface StoredAccount {
  /** Alethego 用户编号（= taskapp.users.id） */
  id: string;
  email: string | null;
  /** 最近一次看到的 TaskApp 名字，只用于账号菜单里显示 */
  displayName: string;
}

export interface AccountRegistry {
  /** 当前账号；null = 没有登录 */
  activeId: string | null;
  accounts: StoredAccount[];
}

/** 存储键：账号列表 */
export const REGISTRY_KEY = 'alethego-tasks.accounts';
/** 存储键前缀：每个账号的会话 */
const SESSION_KEY_PREFIX = 'alethego-tasks.auth.';
/** 存储键：登录页正在使用的临时会话（含 Google 登录往返时的 PKCE 校验码） */
export const PENDING_SESSION_KEY = `${SESSION_KEY_PREFIX}pending`;

export function sessionStorageKey(accountId: string): string {
  return `${SESSION_KEY_PREFIX}${accountId}`;
}

export const EMPTY_REGISTRY: AccountRegistry = { activeId: null, accounts: [] };

/** 最小的存储接口（浏览器里就是 localStorage），便于测试 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadRegistry(storage: KeyValueStorage): AccountRegistry {
  try {
    const raw = storage.getItem(REGISTRY_KEY);
    if (!raw) return EMPTY_REGISTRY;
    const parsed = JSON.parse(raw) as Partial<AccountRegistry>;
    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.filter(
          (a): a is StoredAccount => typeof a?.id === 'string' && typeof a.displayName === 'string',
        )
      : [];
    const activeId = accounts.some((a) => a.id === parsed.activeId) ? parsed.activeId! : null;
    return { activeId, accounts };
  } catch {
    return EMPTY_REGISTRY;
  }
}

export function saveRegistry(storage: KeyValueStorage, registry: AccountRegistry) {
  try {
    storage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // 存储不可用（例如隐私模式）时只在本次页面里有效
  }
}

/** 加入或更新一个账号，并把它设为当前账号 */
export function upsertAccount(registry: AccountRegistry, account: StoredAccount): AccountRegistry {
  const exists = registry.accounts.some((a) => a.id === account.id);
  return {
    activeId: account.id,
    accounts: exists
      ? registry.accounts.map((a) => (a.id === account.id ? account : a))
      : [...registry.accounts, account],
  };
}

/** 去掉一个账号（例如它的会话已经失效）；去掉的是当前账号时，改用列表里剩下的第一个 */
export function removeAccount(registry: AccountRegistry, accountId: string): AccountRegistry {
  const accounts = registry.accounts.filter((a) => a.id !== accountId);
  const activeId = registry.activeId === accountId ? (accounts[0]?.id ?? null) : registry.activeId;
  return { activeId, accounts };
}

export function switchActive(registry: AccountRegistry, accountId: string): AccountRegistry {
  if (!registry.accounts.some((a) => a.id === accountId)) return registry;
  return { ...registry, activeId: accountId };
}

/**
 * TaskApp 名字的默认值：优先用 Alethego 登录信息里的名字（Google 登录会有），
 * 没有就用邮箱 @ 前面那一段。
 */
export function defaultDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = user.user_metadata ?? {};
  for (const key of ['full_name', 'name', 'display_name']) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const local = (user.email ?? '').split('@')[0]?.trim();
  return local || '用户';
}
