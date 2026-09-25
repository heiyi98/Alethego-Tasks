import {
  LOCAL_OWNER_ID,
  SupabaseRemoteStore,
  createRepositories,
  createSupabaseClient,
  type DataStore,
} from '@alethego/data';

/**
 * 浏览器端仓储：直接读写 Supabase（anon key + RLS）。
 * 账号体系接入前，数据固定归属 LOCAL_OWNER_ID。环境变量缺失时返回 null。
 */
export function createBrowserRepositories(): DataStore | null {
  // NEXT_PUBLIC_* 需按字面量引用，才能在构建时内联
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createSupabaseClient({ url, anonKey });
  return createRepositories({
    remote: new SupabaseRemoteStore(client, { ownerId: LOCAL_OWNER_ID }),
  });
}
