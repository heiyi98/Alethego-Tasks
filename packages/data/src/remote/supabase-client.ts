import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { DB_SCHEMA, type Database } from './database.types';

export type TaskAppSupabaseClient = SupabaseClient<Database, typeof DB_SCHEMA>;

export interface SupabaseClientConfig {
  url: string;
  /** 本项目的 publishable/anon key */
  anonKey: string;
  /**
   * 返回当前登录用户的访问令牌。账号由独立的 Alethego 项目签发，本项目通过第三方认证
   * （Third-Party Auth）只验证不签发，因此令牌由调用方（登录模块）注入。
   */
  accessToken: () => Promise<string | null>;
}

export function createSupabaseClient(config: SupabaseClientConfig): TaskAppSupabaseClient {
  return createClient<Database, typeof DB_SCHEMA>(config.url, config.anonKey, {
    // 所有读写都走 taskapp schema（需在 Supabase 的 Exposed schemas 中加入 taskapp）
    db: { schema: DB_SCHEMA },
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
  });
}
