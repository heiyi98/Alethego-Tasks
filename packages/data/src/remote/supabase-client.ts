import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { DB_SCHEMA, type Database } from './database.types';

export type TaskAppSupabaseClient = SupabaseClient<Database, typeof DB_SCHEMA>;

export interface SupabaseClientConfig {
  url: string;
  /** 本项目的 publishable/anon key */
  anonKey: string;
  /**
   * 返回当前用户的访问令牌。账号由独立身份项目签发（Third-Party Auth），本项目只验证不签发，
   * 因此令牌由调用方注入。账号体系接入前不传：以 anon 身份访问，数据归属固定的 LOCAL_OWNER_ID。
   */
  accessToken?: () => Promise<string | null>;
}

export function createSupabaseClient(config: SupabaseClientConfig): TaskAppSupabaseClient {
  return createClient<Database, typeof DB_SCHEMA>(config.url, config.anonKey, {
    // 所有读写都走 taskapp schema（需在 Supabase 的 Exposed schemas 中加入 taskapp）
    db: { schema: DB_SCHEMA },
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
  });
}
