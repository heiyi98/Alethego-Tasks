'use client';

import { ensureCurrentUser, updateDisplayName, type TaskAppSupabaseClient } from '@alethego/data';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  EMPTY_REGISTRY,
  PENDING_SESSION_KEY,
  defaultDisplayName,
  loadRegistry,
  removeAccount,
  saveRegistry,
  sessionStorageKey,
  switchActive,
  upsertAccount,
  type AccountRegistry,
  type KeyValueStorage,
  type StoredAccount,
} from './accounts';
import { LoginPage, type LoginActions } from './login-page';
import { createDataClient } from '@/lib/repositories';

/**
 * 登录状态与会话（整个登录模块的核心）：
 * - 登录 client：连 Alethego 项目，只负责登录、注册、会话保存和自动续期。
 *   每个登录过的账号各用一个 client、各存一份会话，所以切换账号不需要再输密码。
 * - 数据 client 由任务功能自己创建（见 lib/repositories.ts），从这里拿当前账号的 access token。
 *
 * 任务功能的代码只通过 useCurrentUser() 取当前用户；以后改成跳转到 Alethego 统一登录中心时，
 * 只需要替换 src/auth 这个模块。
 */

/** 当前登录用户：任务功能的代码只通过它取用户信息 */
export interface CurrentUser {
  /** Alethego 用户编号（= auth.uid() = taskapp.users.id） */
  id: string;
  email: string | null;
  /** TaskApp 里的名字（taskapp.users.display_name） */
  displayName: string;
  /** 当前 access token；快到期时会先自动续期 */
  getAccessToken: () => Promise<string | null>;
}

interface AccountsApi {
  currentUser: CurrentUser;
  accounts: readonly StoredAccount[];
  switchTo: (accountId: string) => Promise<void>;
  addAccount: () => void;
  signOutAll: () => Promise<void>;
  rename: (displayName: string) => Promise<void>;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'misconfigured' }
  | { status: 'error'; message: string }
  | { status: 'signed-out' }
  | {
      status: 'ready';
      user: CurrentUser;
      dataClient: TaskAppSupabaseClient;
      client: SupabaseClient;
      /** 正在"添加账号"：显示登录页，可取消回到当前账号 */
      adding: boolean;
    };

const ALETHEGO_URL = process.env.NEXT_PUBLIC_ALETHEGO_URL;
const ALETHEGO_KEY = process.env.NEXT_PUBLIC_ALETHEGO_PUBLISHABLE_KEY;

const storage = (): KeyValueStorage => window.localStorage;

/** 每个存储键只建一个登录 client（同一个键建两个会互相干扰） */
const authClients = new Map<string, SupabaseClient>();

function authClient(storageKey: string): SupabaseClient {
  let client = authClients.get(storageKey);
  if (!client) {
    const pending = storageKey === PENDING_SESSION_KEY;
    client = createClient(ALETHEGO_URL!, ALETHEGO_KEY!, {
      auth: {
        storageKey,
        persistSession: true,
        // 登录页用的临时 client 不续期：它的会话一拿到就转存到该账号自己的 client 里
        autoRefreshToken: !pending,
        // 只有登录页的 client 处理 Google 登录回来时地址栏里的授权码
        detectSessionInUrl: pending,
        flowType: 'pkce',
      },
    });
    authClients.set(storageKey, client);
  }
  return client;
}

/** 清掉登录页临时会话留在本机的数据（会话本身已转存给账号自己的 client） */
function clearPending() {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(PENDING_SESSION_KEY)) window.localStorage.removeItem(key);
  }
}

/** Google 登录回来时地址栏里带着授权码，处理完后去掉 */
function stripAuthParams() {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ['code', 'error', 'error_code', 'error_description']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(null, '', url.toString());
}

function loginErrorMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确';
  if (/already registered|already exists/i.test(message)) return '这个邮箱已经注册过';
  if (/password/i.test(message) && /(6|characters|short|weak)/i.test(message)) {
    return '密码至少 6 位';
  }
  if (/email not confirmed/i.test(message)) return '邮箱还没有确认';
  return message;
}

const AuthContext = createContext<AccountsApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    ALETHEGO_URL && ALETHEGO_KEY ? { status: 'loading' } : { status: 'misconfigured' },
  );
  const [registry, setRegistry] = useState<AccountRegistry>(EMPTY_REGISTRY);
  const registryRef = useRef(registry);

  const commit = useCallback((next: AccountRegistry) => {
    registryRef.current = next;
    saveRegistry(storage(), next);
    setRegistry(next);
  }, []);

  /** 启用列表里的当前账号：取它的会话（必要时先续期），确保 taskapp.users 里有这一行 */
  const activate = useCallback(
    async (start: AccountRegistry) => {
      let next = start;
      while (next.activeId) {
        const id = next.activeId;
        const client = authClient(sessionStorageKey(id));
        const { data } = await client.auth.getSession();
        const session = data.session;
        if (!session || session.user.id !== id) {
          // 会话已失效（例如在别处被撤销）：从列表里去掉，改用下一个
          next = removeAccount(next, id);
          continue;
        }
        const getAccessToken = async () =>
          (await client.auth.getSession()).data.session?.access_token ?? null;
        const dataClient = createDataClient(getAccessToken);
        if (!dataClient) {
          setState({ status: 'misconfigured' });
          return;
        }
        try {
          // 访问任何业务数据之前：没有就创建（默认名字），有就只更新 email
          const profile = await ensureCurrentUser(dataClient, {
            email: session.user.email ?? null,
            defaultDisplayName: defaultDisplayName(session.user),
          });
          next = upsertAccount(next, {
            id,
            email: profile.email,
            displayName: profile.displayName,
          });
          commit(next);
          setState({
            status: 'ready',
            user: { ...profile, getAccessToken },
            dataClient,
            client,
            adding: false,
          });
        } catch (e) {
          commit(next);
          setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
      commit(next);
      setState({ status: 'signed-out' });
    },
    [commit],
  );

  /** 刚登录拿到的会话转存到这个账号自己的 client 里，并切换到它 */
  const adopt = useCallback(
    async (session: Session) => {
      const id = session.user.id;
      const client = authClient(sessionStorageKey(id));
      const { error } = await client.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      clearPending();
      if (error) throw error;
      const current = registryRef.current;
      const known = current.accounts.find((a) => a.id === id);
      const next = upsertAccount(current, {
        id,
        email: session.user.email ?? null,
        displayName: known?.displayName ?? defaultDisplayName(session.user),
      });
      setState({ status: 'loading' });
      await activate(next);
    },
    [activate],
  );

  // 首次加载：先处理 Google 登录回来的授权码，再启用上次的当前账号
  useEffect(() => {
    if (!ALETHEGO_URL || !ALETHEGO_KEY) return;
    let cancelled = false;
    void (async () => {
      const initial = loadRegistry(storage());
      registryRef.current = initial;
      setRegistry(initial);
      const pending = authClient(PENDING_SESSION_KEY);
      const { data } = await pending.auth.getSession();
      stripAuthParams();
      if (cancelled) return;
      if (data.session) {
        await adopt(data.session);
        return;
      }
      clearPending();
      await activate(initial);
    })();
    return () => {
      cancelled = true;
    };
  }, [activate, adopt]);

  // 当前账号的会话在别处被撤销（续期失败）时：去掉它，改用下一个账号或回到登录页
  const activeClient = state.status === 'ready' ? state.client : null;
  const activeId = state.status === 'ready' ? state.user.id : null;
  useEffect(() => {
    if (!activeClient || !activeId) return;
    const { data } = activeClient.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      setState({ status: 'loading' });
      void activate(removeAccount(registryRef.current, activeId));
    });
    return () => data.subscription.unsubscribe();
  }, [activeClient, activeId, activate]);

  const loginActions: LoginActions = useMemo(
    () => ({
      async signIn(email, password) {
        const { data, error } = await authClient(PENDING_SESSION_KEY).auth.signInWithPassword({
          email,
          password,
        });
        if (error || !data.session) return { error: loginErrorMessage(error?.message ?? '') };
        await adopt(data.session);
        return {};
      },
      async signUp(email, password) {
        const { data, error } = await authClient(PENDING_SESSION_KEY).auth.signUp({
          email,
          password,
        });
        if (error) return { error: loginErrorMessage(error.message) };
        // 需要先确认邮箱时没有会话
        if (!data.session) return { needsConfirmation: true };
        await adopt(data.session);
        return {};
      },
      async signInWithGoogle() {
        const { error } = await authClient(PENDING_SESSION_KEY).auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
        });
        return error ? { error: loginErrorMessage(error.message) } : {};
      },
    }),
    [adopt],
  );

  const api: AccountsApi | null = useMemo(() => {
    if (state.status !== 'ready') return null;
    return {
      currentUser: state.user,
      accounts: registry.accounts,
      async switchTo(accountId) {
        if (accountId === state.user.id) return;
        setState({ status: 'loading' });
        await activate(switchActive(registryRef.current, accountId));
      },
      addAccount() {
        setState({ ...state, adding: true });
      },
      async signOutAll() {
        // 只退出 TaskApp 在这台设备上的会话（撤销这些会话的续期凭证），不影响别的产品
        for (const account of registryRef.current.accounts) {
          try {
            await authClient(sessionStorageKey(account.id)).auth.signOut({ scope: 'local' });
          } catch {
            // 网络失败也照样清掉本机的会话
          }
          window.localStorage.removeItem(sessionStorageKey(account.id));
        }
        clearPending();
        commit(EMPTY_REGISTRY);
        setState({ status: 'signed-out' });
      },
      async rename(displayName) {
        const profile = await updateDisplayName(state.dataClient, state.user.id, displayName);
        commit(
          upsertAccount(registryRef.current, {
            id: profile.id,
            email: profile.email,
            displayName: profile.displayName,
          }),
        );
        setState({ ...state, user: { ...state.user, displayName: profile.displayName } });
      },
    };
  }, [state, registry, activate, commit]);

  switch (state.status) {
    case 'loading':
      return <div className="auth-loading" aria-busy="true" />;
    case 'misconfigured':
      return (
        <main className="page">
          <div className="notice notice-error">
            <p>尚未配置 Supabase。</p>
            <p>
              请在 <code>apps/web/.env.local</code> 中设置 <code>NEXT_PUBLIC_ALETHEGO_URL</code>、
              <code>NEXT_PUBLIC_ALETHEGO_PUBLISHABLE_KEY</code>、
              <code>NEXT_PUBLIC_SUPABASE_URL</code> 与 <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
              （参考 <code>.env.example</code>）。
            </p>
          </div>
        </main>
      );
    case 'error':
      return (
        <main className="page">
          <p className="notice notice-error">加载失败：{state.message}</p>
        </main>
      );
    case 'signed-out':
      return <LoginPage actions={loginActions} />;
    case 'ready':
      if (state.adding) {
        return (
          <LoginPage
            actions={loginActions}
            onCancel={() => setState({ ...state, adding: false })}
          />
        );
      }
      return (
        <AuthContext.Provider value={api}>
          {/* 换账号时整棵任务界面重新挂载，不会带着上一个账号的数据 */}
          <Fragment key={state.user.id}>{children}</Fragment>
        </AuthContext.Provider>
      );
  }
}

function useAuth(): AccountsApi {
  const api = useContext(AuthContext);
  if (!api) throw new Error('只能在登录后的界面里使用（AuthProvider 内）');
  return api;
}

/** "当前用户"入口：任务功能的代码只通过它取用户信息 */
export function useCurrentUser(): CurrentUser {
  return useAuth().currentUser;
}

/** 账号菜单用：账号列表、切换、添加、退出、改名 */
export function useAccounts(): AccountsApi {
  return useAuth();
}
