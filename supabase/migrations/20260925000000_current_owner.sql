-- 当前数据所有者。
--
-- 【临时：无登录模式】账号体系尚未接入，所有数据归属一个写死的固定 owner_id。
-- 该值必须与 packages/data/src/owner.ts 中的 LOCAL_OWNER_ID 保持一致。
--
-- 这意味着任何持有 anon key 的人都能读写这个固定用户的数据，只适用于本地开发 / 内测前。
-- 接入账号体系时只需：
--   1. 把函数体改为 `select auth.uid()`
--   2. 在 RLS 策略中去掉 anon 角色
-- 表结构与其余策略都不用动。

create function public.current_owner_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid);
$$;
