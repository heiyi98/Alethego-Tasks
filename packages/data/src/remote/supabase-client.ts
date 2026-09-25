import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

export type TaskAppSupabaseClient = SupabaseClient<Database>;

export interface SupabaseClientConfig {
  url: string;
  /** 本项目的 publishable/anon key */
  anonKey: string;
  /**
   * 返回当前用户的访问令牌。账号由独立身份项目签发（Third-Party Auth），本项目只验证不签发，
   * 因此令牌由调用方注入；认证接入前可不传，此时只能以匿名身份访问（受 RLS 限制）。
   */
  accessToken?: () => Promise<string | null>;
}

export function createSupabaseClient(config: SupabaseClientConfig): TaskAppSupabaseClient {
  return createClient<Database>(config.url, config.anonKey, {
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
  });
}
