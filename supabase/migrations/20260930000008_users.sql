-- 接入 Alethego 账号。
--
-- 登录由独立的 Alethego 项目负责；本项目通过第三方认证（Third-Party Auth）信任 Alethego 签发的
-- access token，auth.uid() 就是用户在 Alethego 的编号。本项目的 auth.users 中没有用户记录，
-- TaskApp 自己的用户信息放在 taskapp.users。

-- 1. 清空全部现有业务数据（无登录阶段写入的固定假用户数据，以及第三方认证测试时插入的数据）----

delete from taskapp.task_people;
delete from taskapp.task_locations;
delete from taskapp.task_categories;
delete from taskapp.recurrence_occurrences;
delete from taskapp.tasks;
delete from taskapp.categories;

-- 2. TaskApp 自己的用户表 --------------------------------------------------------------------
--
-- id 就是 auth.uid()（Alethego 用户编号）。
-- email 每次登录时按 Alethego 的最新值更新；display_name 只在创建时取默认值，
-- 之后只由用户在 TaskApp 里修改，不再被 Alethego 覆盖（见 ensure_current_user）。

create table taskapp.users (
  id           uuid primary key default auth.uid(),
  email        text,
  display_name text not null
               constraint users_display_name_not_blank check (btrim(display_name) <> ''),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on taskapp.users
  for each row execute function taskapp.set_updated_at();

-- 3. 当前数据所有者：只读 auth.uid()，去掉固定假用户的回退值 --------------------------------

create or replace function taskapp.current_owner_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid();
$$;

-- 4. 任务与分类归属到 taskapp.users -----------------------------------------------------------

alter table taskapp.tasks
  add constraint tasks_owner_id_fkey foreign key (owner_id) references taskapp.users (id);
alter table taskapp.categories
  add constraint categories_owner_id_fkey foreign key (owner_id) references taskapp.users (id);

-- 5. 用户表 RLS：只能读、建、改自己那一行（不开放删除） -------------------------------------

alter table taskapp.users enable row level security;

create policy "users_select_own" on taskapp.users
  for select to authenticated
  using (id = (select taskapp.current_owner_id()));

create policy "users_insert_own" on taskapp.users
  for insert to authenticated
  with check (id = (select taskapp.current_owner_id()));

create policy "users_update_own" on taskapp.users
  for update to authenticated
  using (id = (select taskapp.current_owner_id()))
  with check (id = (select taskapp.current_owner_id()));

-- 登录后、访问任何业务数据之前调用：还没有这一行就创建（display_name 取传入的默认值），
-- 已有则只更新 email。以调用者身份执行（security invoker），仍受上面的 RLS 约束。
create function taskapp.ensure_current_user(p_email text, p_display_name text)
returns taskapp.users
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into taskapp.users (id, email, display_name)
  values (auth.uid(), p_email, p_display_name)
  on conflict (id) do update set email = excluded.email
  returning *;
$$;

grant select, insert, update on taskapp.users to authenticated, service_role;
grant execute on function taskapp.ensure_current_user(text, text) to authenticated, service_role;

-- 6. 所有 RLS 策略去掉 anon，只保留 authenticated -----------------------------------------

alter policy "tasks_select_own" on taskapp.tasks to authenticated;
alter policy "tasks_insert_own" on taskapp.tasks to authenticated;
alter policy "tasks_update_own" on taskapp.tasks to authenticated;

alter policy "categories_select_own" on taskapp.categories to authenticated;
alter policy "categories_insert_own" on taskapp.categories to authenticated;
alter policy "categories_update_own" on taskapp.categories to authenticated;
alter policy "categories_delete_own" on taskapp.categories to authenticated;

alter policy "task_categories_select_own" on taskapp.task_categories to authenticated;
alter policy "task_categories_insert_own" on taskapp.task_categories to authenticated;
alter policy "task_categories_delete_own" on taskapp.task_categories to authenticated;

alter policy "recurrence_occurrences_select_own" on taskapp.recurrence_occurrences to authenticated;
alter policy "recurrence_occurrences_insert_own" on taskapp.recurrence_occurrences to authenticated;
alter policy "recurrence_occurrences_update_own" on taskapp.recurrence_occurrences to authenticated;

alter policy "task_locations_select_own" on taskapp.task_locations to authenticated;
alter policy "task_locations_insert_own" on taskapp.task_locations to authenticated;
alter policy "task_locations_update_own" on taskapp.task_locations to authenticated;
alter policy "task_locations_delete_own" on taskapp.task_locations to authenticated;

alter policy "task_people_select_own" on taskapp.task_people to authenticated;
alter policy "task_people_insert_own" on taskapp.task_people to authenticated;
alter policy "task_people_update_own" on taskapp.task_people to authenticated;
alter policy "task_people_delete_own" on taskapp.task_people to authenticated;
