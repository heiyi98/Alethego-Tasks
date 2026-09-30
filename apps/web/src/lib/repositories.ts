import {
  SupabaseRemoteStore,
  createRepositories,
  createSupabaseClient,
  type DataStore,
  type TaskAppSupabaseClient,
} from '@alethego/data';

/**
 * 数据 client：连存放 TaskApp 数据的 Supabase 项目（taskapp schema），apikey 用该项目的 key；
 * 每次请求带上登录模块给出的当前 Alethego access token（该项目通过第三方认证信任 Alethego 的令牌）。
 * 环境变量缺失时返回 null。
 */
export function createDataClient(
  accessToken: () => Promise<string | null>,
): TaskAppSupabaseClient | null {
  // NEXT_PUBLIC_* 需按字面量引用，才能在构建时内联
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createSupabaseClient({ url, anonKey, accessToken });
}

/** 浏览器端仓储：直接读写 Supabase（RLS 按 auth.uid() 隔离），数据归属当前登录用户 */
export function createBrowserRepositories(user: {
  id: string;
  getAccessToken: () => Promise<string | null>;
}): DataStore | null {
  const client = createDataClient(user.getAccessToken);
  if (!client) return null;
  return createRepositories({
    remote: new SupabaseRemoteStore(client, { ownerId: user.id }),
  });
}
