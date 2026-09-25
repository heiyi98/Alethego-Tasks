/**
 * 【临时：无登录模式】账号体系接入前，所有数据归属这个固定的 owner_id。
 * 必须与 supabase/migrations/20260925000000_current_owner.sql 中 current_owner_id() 的值一致。
 * 接入账号体系后改为当前登录用户的 id。
 */
export const LOCAL_OWNER_ID = '00000000-0000-0000-0000-000000000001';
