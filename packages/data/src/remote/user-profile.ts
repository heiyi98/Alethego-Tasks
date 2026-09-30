import { DataError } from '../errors';
import type { TableRow } from './database.types';
import type { TaskAppSupabaseClient } from './supabase-client';

/** TaskApp 自己的用户信息（taskapp.users） */
export interface UserProfile {
  /** 等于 auth.uid()，即 Alethego 用户编号 */
  id: string;
  email: string | null;
  displayName: string;
}

export function userProfileFromRow(row: TableRow<'users'>): UserProfile {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

/**
 * 登录后、访问任何业务数据之前调用：taskapp.users 里还没有当前用户就创建一行
 * （display_name 取传入的默认值），已有则只把 email 更新为 Alethego 的最新值。
 */
export async function ensureCurrentUser(
  client: TaskAppSupabaseClient,
  input: { email: string | null; defaultDisplayName: string },
): Promise<UserProfile> {
  const { data, error } = await client.rpc('ensure_current_user', {
    p_email: input.email,
    p_display_name: input.defaultDisplayName,
  });
  if (error || !data)
    throw new DataError('unknown', `创建用户信息失败：${error?.message ?? '无返回'}`);
  return userProfileFromRow(data as TableRow<'users'>);
}

/** 修改当前用户在 TaskApp 里的名字 */
export async function updateDisplayName(
  client: TaskAppSupabaseClient,
  userId: string,
  displayName: string,
): Promise<UserProfile> {
  const name = displayName.trim();
  if (!name) throw new DataError('invalid', '名字不能为空');
  const { data, error } = await client
    .from('users')
    .update({ display_name: name })
    .eq('id', userId)
    .select()
    .single();
  if (error || !data) throw new DataError('unknown', `修改名字失败：${error?.message ?? '无返回'}`);
  return userProfileFromRow(data);
}
