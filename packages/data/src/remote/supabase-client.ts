import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

export type TaskAppSupabaseClient = SupabaseClient<Database>;

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
  return createClient<Database>(config.url, config.anonKey, {
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
  });
}
