-- TaskApp 完整建库脚本：由 supabase/migrations 按顺序合并生成，不要手改。
-- 重新生成：node supabase/scripts/build-full-schema.mjs
-- 在全新的 Supabase 项目的 SQL Editor 里一次执行即可（不含本地测试用的时钟替换）。

begin;

-- ==== 20260925000000_current_owner.sql ====

-- 业务表统一放在独立的 taskapp schema 中，不使用 public。
-- 需要在 Supabase 控制台 Project Settings → API → Exposed schemas 中加入 taskapp，
-- 前端才能通过 Data API 访问（客户端已配置 db.schema = 'taskapp'）。

create schema if not exists taskapp;

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

create function taskapp.current_owner_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.uid(), '00000000-0000-0000-0000-000000000001'::uuid);
$$;

-- ==== 20260925000001_tasks.sql ====

-- 核心表：tasks
-- 只存放矩阵计算、筛选、排序真正需要的字段。任务状态（待办/已错过/已完成）为派生值，不存储。
--
-- owner_id 不设外键指向 auth.users：账号由独立身份项目签发（Third-Party Auth），
-- 本项目的 auth.users 中没有用户记录。未登录阶段取固定值，见 current_owner_id()。
--
-- 删除为软删除（deleted_at），不物理删除。

create table taskapp.tasks (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default taskapp.current_owner_id(),
  title              text not null
                     constraint tasks_title_not_blank check (btrim(title) <> ''),
  description        text not null default '',
  deadline_at        timestamptz,
  importance_level   smallint not null default 0
                     constraint tasks_importance_level_range check (importance_level between 0 and 5),
  recurrence_rule    text,
  recurrence_dtstart timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  -- 循环开关打开时必须有起始时间；关闭（清空规则）时可保留起始时间
  constraint tasks_recurrence_requires_dtstart
    check (recurrence_rule is null or recurrence_dtstart is not null)
);

comment on column taskapp.tasks.importance_level is '重要性 0-5：0 = 未设置，1-5 为用户设置的档位';
comment on column taskapp.tasks.recurrence_rule is 'RFC 5545 RRULE；非空即为循环任务';

-- 列表默认排序：截止时间从近到远，无截止时间排最后；只索引未删除的任务
create index tasks_owner_deadline_idx on taskapp.tasks (owner_id, deadline_at asc nulls last)
  where deleted_at is null;

-- updated_at 用于同步冲突解决（Last-Write-Wins）；软删除同样会刷新它，删除标记可随同步传播
create function taskapp.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
  before update on taskapp.tasks
  for each row execute function taskapp.set_updated_at();

-- ==== 20260925000002_categories.sql ====

-- 分类：与任务多对多。删除分类只级联删除关联行，任务本体不受影响。
-- 任务是软删除，其关联行与实例记录随任务保留，不会被级联删除。

create table taskapp.categories (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default taskapp.current_owner_id(),
  name       text not null,
  color      text not null
             constraint categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

-- 颜色在同一用户的分类集合内排他（不区分大小写）
create unique index categories_owner_color_key on taskapp.categories (owner_id, lower(color));

create table taskapp.task_categories (
  task_id     uuid not null references taskapp.tasks (id) on delete cascade,
  category_id uuid not null references taskapp.categories (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (task_id, category_id)
);

-- 主键已覆盖按 task_id 查询；按分类筛选任务需要反向索引
create index task_categories_category_id_idx on taskapp.task_categories (category_id);

-- ==== 20260925000003_recurrence_occurrences.sql ====

-- 循环任务实例记录。
-- 独立于 tasks.recurrence_rule 存续：关闭循环开关或清空规则后，历史记录依然保留，
-- 只在对应任务被物理删除时级联删除（任务日常删除为软删除，记录保留）。

create type taskapp.occurrence_status as enum ('pending', 'completed', 'missed');

create table taskapp.recurrence_occurrences (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references taskapp.tasks (id) on delete cascade,
  occurrence_date timestamptz not null,
  status          taskapp.occurrence_status not null default 'pending',
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),

  -- 同一任务的同一次实例只有一条记录（归档可能被多端重复执行）
  constraint recurrence_occurrences_task_date_key unique (task_id, occurrence_date)
);

comment on column taskapp.recurrence_occurrences.status is
  'pending = 已出现未判定；missed = 下一实例出现时仍未完成，系统自动归档，用户可事后修改';

-- ==== 20260925000004_rls.sql ====

-- 行级安全：所有数据按 owner_id = current_owner_id() 隔离。
-- 使用 (select ...) 包裹，让函数每条语句只求值一次。
--
-- 【临时：无登录模式】策略同时开放给 anon 角色，配合 current_owner_id() 的固定值使用；
-- 接入账号体系后把各策略中的 anon 去掉即可。
--
-- 不开放物理删除的表：
-- - tasks：删除一律为软删除（update deleted_at）
-- - recurrence_occurrences：历史记录只随任务物理删除而级联删除，用户只能修改状态

alter table taskapp.tasks enable row level security;
alter table taskapp.categories enable row level security;
alter table taskapp.task_categories enable row level security;
alter table taskapp.recurrence_occurrences enable row level security;

-- tasks ------------------------------------------------------------------

create policy "tasks_select_own" on taskapp.tasks
  for select to anon, authenticated
  using (owner_id = (select taskapp.current_owner_id()));

create policy "tasks_insert_own" on taskapp.tasks
  for insert to anon, authenticated
  with check (owner_id = (select taskapp.current_owner_id()));

create policy "tasks_update_own" on taskapp.tasks
  for update to anon, authenticated
  using (owner_id = (select taskapp.current_owner_id()))
  with check (owner_id = (select taskapp.current_owner_id()));

-- categories -------------------------------------------------------------

create policy "categories_select_own" on taskapp.categories
  for select to anon, authenticated
  using (owner_id = (select taskapp.current_owner_id()));

create policy "categories_insert_own" on taskapp.categories
  for insert to anon, authenticated
  with check (owner_id = (select taskapp.current_owner_id()));

create policy "categories_update_own" on taskapp.categories
  for update to anon, authenticated
  using (owner_id = (select taskapp.current_owner_id()))
  with check (owner_id = (select taskapp.current_owner_id()));

create policy "categories_delete_own" on taskapp.categories
  for delete to anon, authenticated
  using (owner_id = (select taskapp.current_owner_id()));

-- task_categories --------------------------------------------------------
-- 任务和分类都必须属于当前用户，防止把自己的任务挂到别人的分类上（或反之）。

create function taskapp.owns_task(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t
    where t.id = p_task_id and t.owner_id = (select taskapp.current_owner_id())
  );
$$;

create function taskapp.owns_category(p_category_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.categories c
    where c.id = p_category_id and c.owner_id = (select taskapp.current_owner_id())
  );
$$;

create policy "task_categories_select_own" on taskapp.task_categories
  for select to anon, authenticated
  using (taskapp.owns_task(task_id) and taskapp.owns_category(category_id));

create policy "task_categories_insert_own" on taskapp.task_categories
  for insert to anon, authenticated
  with check (taskapp.owns_task(task_id) and taskapp.owns_category(category_id));

create policy "task_categories_delete_own" on taskapp.task_categories
  for delete to anon, authenticated
  using (taskapp.owns_task(task_id) and taskapp.owns_category(category_id));

-- 关联行只有增删，没有有意义的更新，因此不开放 update

-- recurrence_occurrences -------------------------------------------------

create policy "recurrence_occurrences_select_own" on taskapp.recurrence_occurrences
  for select to anon, authenticated
  using (taskapp.owns_task(task_id));

create policy "recurrence_occurrences_insert_own" on taskapp.recurrence_occurrences
  for insert to anon, authenticated
  with check (taskapp.owns_task(task_id));

create policy "recurrence_occurrences_update_own" on taskapp.recurrence_occurrences
  for update to anon, authenticated
  using (taskapp.owns_task(task_id))
  with check (taskapp.owns_task(task_id));

-- 权限 -------------------------------------------------------------------
-- Supabase 只会自动给 public schema 中的对象授权，自定义 schema 需要显式授予。
-- 表级权限只决定"能否尝试"某类操作，具体能看到/改动哪些行仍由上面的 RLS 策略决定
-- （例如 tasks 虽授予了 delete，但没有 delete 策略，物理删除依然被拒绝）。
-- service_role 供 Supabase 控制台与服务端使用，本身绕过 RLS。

grant usage on schema taskapp to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema taskapp
  to anon, authenticated, service_role;
grant execute on all functions in schema taskapp to anon, authenticated, service_role;

-- 之后新增的表 / 函数自动获得同样的权限
alter default privileges in schema taskapp
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema taskapp
  grant execute on functions to anon, authenticated, service_role;

-- ==== 20260927000005_task_details.sql ====

-- 任务详情扩展表：地点（一对一）、人物（一对多）。
-- 按《04-数据模型文档》字段扩展原则：需要对接外部标准 API 的字段用独立表，结构对齐外部 API
-- （place_id ↔ 地图 API，contact_id ↔ 系统通讯录）。目前只编辑本地自由文本，外部字段先留空。
-- tasks 表不感知这两张表；详情页由 TaskDetailAggregator 统一拼装。
-- 任务是软删除，扩展数据随任务保留；只有任务被物理删除时才级联删除。

-- 地点：一个任务至多一个地点（task_id 即主键）
create table taskapp.task_locations (
  task_id    uuid primary key references taskapp.tasks (id) on delete cascade,
  name       text not null default '',
  address    text not null default '',
  -- 预留：对接地图 API 时使用
  place_id   text,
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 没有任何内容的地点不应存在（清空地点 = 删除这一行）
  constraint task_locations_not_empty
    check (btrim(name) <> '' or btrim(address) <> '' or place_id is not null),
  constraint task_locations_coordinates
    check (
      (lat is null and lng is null)
      or (lat between -90 and 90 and lng between -180 and 180)
    )
);

create trigger task_locations_set_updated_at
  before update on taskapp.task_locations
  for each row execute function taskapp.set_updated_at();

-- 人物：一个任务可关联多个人
create table taskapp.task_people (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references taskapp.tasks (id) on delete cascade,
  name       text not null
             constraint task_people_name_not_blank check (btrim(name) <> ''),
  relation   text not null default '',
  -- 预留：对接系统通讯录时使用
  contact_id text,
  created_at timestamptz not null default now()
);

create index task_people_task_id_idx on taskapp.task_people (task_id);

-- RLS：归属跟随任务（owns_task 见 20260925000004_rls.sql）
alter table taskapp.task_locations enable row level security;
alter table taskapp.task_people enable row level security;

create policy "task_locations_select_own" on taskapp.task_locations
  for select to anon, authenticated using (taskapp.owns_task(task_id));
create policy "task_locations_insert_own" on taskapp.task_locations
  for insert to anon, authenticated with check (taskapp.owns_task(task_id));
create policy "task_locations_update_own" on taskapp.task_locations
  for update to anon, authenticated
  using (taskapp.owns_task(task_id)) with check (taskapp.owns_task(task_id));
create policy "task_locations_delete_own" on taskapp.task_locations
  for delete to anon, authenticated using (taskapp.owns_task(task_id));

create policy "task_people_select_own" on taskapp.task_people
  for select to anon, authenticated using (taskapp.owns_task(task_id));
create policy "task_people_insert_own" on taskapp.task_people
  for insert to anon, authenticated with check (taskapp.owns_task(task_id));
create policy "task_people_update_own" on taskapp.task_people
  for update to anon, authenticated
  using (taskapp.owns_task(task_id)) with check (taskapp.owns_task(task_id));
create policy "task_people_delete_own" on taskapp.task_people
  for delete to anon, authenticated using (taskapp.owns_task(task_id));

-- 显式授权（不依赖之前的 default privileges 是否由同一角色设置）
grant select, insert, update, delete on taskapp.task_locations, taskapp.task_people
  to anon, authenticated, service_role;

-- ==== 20260928000006_category_description.sql ====

-- 分类描述：可选的自由文本，默认空字符串。
-- 只新增一列（有默认值），不改动已有字段与约束；已有分类的描述为空。
alter table taskapp.categories
  add column description text not null default '';

comment on column taskapp.categories.description is '分类描述，自由文本，可为空字符串';

-- ==== 20260929000007_task_starred.sql ====

-- 任务标星：只是书签，不影响矩阵位置、排序或任何其他规则。
-- 只新增一列（有默认值），不改动已有字段与约束；已有任务均为未标星。
alter table taskapp.tasks
  add column is_starred boolean not null default false;

comment on column taskapp.tasks.is_starred is '标星（书签），默认 false';

-- ==== 20260930000008_users.sql ====

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

-- ==== 20261001000009_groups.sql ====

-- 合作组。
--
-- "组"是和个人同级的任务容器：组任务与个人任务用同一张 tasks 表，只是多记一个 group_id。
-- 组有三种类型（合作组 / 管理组 / 教育组），建组时确定、之后不能改；这一批只做合作组。
-- 组之间什么都不共用：名单、昵称、任务都各归各的组；组里没有分类，组也不能被归进分类。
--
-- 权限按组的类型在后台生效，不给每条任务逐个写角色：
--   合作组里所有成员都是组长，对每条任务都是 R（标记完成）和 A（确认完成、编辑任务内容）；
--   同一个人既是 R 又是 A，标记完成就算确认完成，所以只有一个完成时间。
-- 组成员能看、建、改组里的任务及其相关数据（循环记录、人物、地点），非成员完全看不到。
--
-- 名单、邀请、删除组的投票等写操作都通过下面的函数完成（security definer，函数内自己检查身份）。

-- 时钟 -----------------------------------------------------------------------------------------
-- 与时间有关的规则（邀请时间、删除组的投票超时）统一用这个函数取当前时间。
-- 生产环境就是 now()；本地端到端测试会替换它来模拟"一周以后"（见 apps/web/e2e/sql/test-clock.sql）。

create function taskapp.clock_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

-- 组 -------------------------------------------------------------------------------------------

create table taskapp.groups (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null
             constraint groups_kind_check check (kind in ('cooperative', 'management', 'education')),
  name       text not null
             constraint groups_name_not_blank check (btrim(name) <> ''),
  created_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger groups_set_updated_at
  before update on taskapp.groups
  for each row execute function taskapp.set_updated_at();

-- 类型建组时确定，之后不能改
create function taskapp.groups_kind_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception '组的类型不能修改' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger groups_kind_immutable
  before update on taskapp.groups
  for each row execute function taskapp.groups_kind_immutable();

-- 名单。合作组里所有成员都是组长（role = 'leader'）。
-- nickname 只在本组显示；为 null 时显示他的 TaskApp 名字（users.display_name）。
create table taskapp.group_members (
  group_id  uuid not null references taskapp.groups (id) on delete cascade,
  user_id   uuid not null references taskapp.users (id),
  role      text not null default 'leader'
            constraint group_members_role_check check (role in ('leader', 'member')),
  nickname  text
            constraint group_members_nickname_not_blank check (nickname is null or btrim(nickname) <> ''),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_id_idx on taskapp.group_members (user_id);

-- 邀请：按邮箱邀请，不发邮件；被邀请的人登录后在通知里看到（从没用过 TaskApp 也一样）。
-- 同意 = 成为成员并删除邀请；拒绝 = 删除邀请。
create table taskapp.group_invitations (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references taskapp.groups (id) on delete cascade,
  email      text not null
             constraint group_invitations_email_normalized check (email = lower(btrim(email)) and email <> ''),
  invited_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default taskapp.clock_now(),
  unique (group_id, email)
);

create index group_invitations_email_idx on taskapp.group_invitations (email);

-- 删除组的投票：每个组同一时间最多一次。发起者算作同意；只要有一位组长不同意，这次删除就取消
-- （删除这一行，以后可以重新发起）。一周内没有操作的组长算作同意。
create table taskapp.group_deletion_requests (
  group_id     uuid primary key references taskapp.groups (id) on delete cascade,
  initiated_by uuid not null references taskapp.users (id),
  started_at   timestamptz not null default taskapp.clock_now()
);

-- 只记"同意"；不同意直接取消整次删除
create table taskapp.group_deletion_votes (
  group_id uuid not null references taskapp.group_deletion_requests (group_id) on delete cascade,
  user_id  uuid not null references taskapp.users (id),
  voted_at timestamptz not null default taskapp.clock_now(),
  primary key (group_id, user_id)
);

-- 通知：上次打开通知的时间，之后出现的通知算未读
alter table taskapp.users add column notifications_seen_at timestamptz;

-- 任务：多记一个"属于哪个组" ----------------------------------------------------------------

alter table taskapp.tasks
  add column group_id uuid references taskapp.groups (id) on delete cascade;

create index tasks_group_id_idx on taskapp.tasks (group_id) where group_id is not null;

-- 组里不使用重要性和收藏
alter table taskapp.tasks
  add constraint tasks_group_fields check (
    group_id is null or (importance_level = 0 and not is_starred)
  );

-- 任务不能在容器之间移动
create function taskapp.tasks_container_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id then
    raise exception '任务不能在个人和组之间移动' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger tasks_container_immutable
  before update on taskapp.tasks
  for each row execute function taskapp.tasks_container_immutable();

-- 权限判断 -------------------------------------------------------------------------------------

-- 当前用户是不是这个组的成员（security definer：避免 group_members 的 RLS 递归）
create function taskapp.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid()
  );
$$;

-- 个人任务：只认个人任务（分类只属于个人，task_categories 用它）
create or replace function taskapp.owns_task(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t
    where t.id = p_task_id
      and t.group_id is null
      and t.owner_id = (select taskapp.current_owner_id())
  );
$$;

-- 能访问这条任务：自己的个人任务，或自己所在组的任务（循环记录、人物、地点用它）
create function taskapp.can_access_task(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t
    where t.id = p_task_id
      and (
        (t.group_id is null and t.owner_id = (select taskapp.current_owner_id()))
        or (t.group_id is not null and taskapp.is_group_member(t.group_id))
      )
  );
$$;

-- RLS：任务 -------------------------------------------------------------------------------------

drop policy "tasks_select_own" on taskapp.tasks;
drop policy "tasks_insert_own" on taskapp.tasks;
drop policy "tasks_update_own" on taskapp.tasks;

create policy "tasks_select" on taskapp.tasks
  for select to authenticated
  using (
    (group_id is null and owner_id = (select taskapp.current_owner_id()))
    or (group_id is not null and taskapp.is_group_member(group_id))
  );

-- 组任务由组长创建（合作组里所有成员都是组长），owner_id 记创建者
create policy "tasks_insert" on taskapp.tasks
  for insert to authenticated
  with check (
    owner_id = (select taskapp.current_owner_id())
    and (group_id is null or taskapp.is_group_member(group_id))
  );

-- 编辑、标记完成、软删除：个人任务只有自己；组任务是组里的成员（合作组里人人都是 R 和 A）
create policy "tasks_update" on taskapp.tasks
  for update to authenticated
  using (
    (group_id is null and owner_id = (select taskapp.current_owner_id()))
    or (group_id is not null and taskapp.is_group_member(group_id))
  )
  with check (
    (group_id is null and owner_id = (select taskapp.current_owner_id()))
    or (group_id is not null and taskapp.is_group_member(group_id))
  );

-- RLS：循环记录、地点、人物跟随任务的访问权 ---------------------------------------------------

drop policy "recurrence_occurrences_select_own" on taskapp.recurrence_occurrences;
drop policy "recurrence_occurrences_insert_own" on taskapp.recurrence_occurrences;
drop policy "recurrence_occurrences_update_own" on taskapp.recurrence_occurrences;

create policy "recurrence_occurrences_select" on taskapp.recurrence_occurrences
  for select to authenticated using (taskapp.can_access_task(task_id));
create policy "recurrence_occurrences_insert" on taskapp.recurrence_occurrences
  for insert to authenticated with check (taskapp.can_access_task(task_id));
create policy "recurrence_occurrences_update" on taskapp.recurrence_occurrences
  for update to authenticated
  using (taskapp.can_access_task(task_id)) with check (taskapp.can_access_task(task_id));

drop policy "task_locations_select_own" on taskapp.task_locations;
drop policy "task_locations_insert_own" on taskapp.task_locations;
drop policy "task_locations_update_own" on taskapp.task_locations;
drop policy "task_locations_delete_own" on taskapp.task_locations;

create policy "task_locations_select" on taskapp.task_locations
  for select to authenticated using (taskapp.can_access_task(task_id));
create policy "task_locations_insert" on taskapp.task_locations
  for insert to authenticated with check (taskapp.can_access_task(task_id));
create policy "task_locations_update" on taskapp.task_locations
  for update to authenticated
  using (taskapp.can_access_task(task_id)) with check (taskapp.can_access_task(task_id));
create policy "task_locations_delete" on taskapp.task_locations
  for delete to authenticated using (taskapp.can_access_task(task_id));

drop policy "task_people_select_own" on taskapp.task_people;
drop policy "task_people_insert_own" on taskapp.task_people;
drop policy "task_people_update_own" on taskapp.task_people;
drop policy "task_people_delete_own" on taskapp.task_people;

create policy "task_people_select" on taskapp.task_people
  for select to authenticated using (taskapp.can_access_task(task_id));
create policy "task_people_insert" on taskapp.task_people
  for insert to authenticated with check (taskapp.can_access_task(task_id));
create policy "task_people_update" on taskapp.task_people
  for update to authenticated
  using (taskapp.can_access_task(task_id)) with check (taskapp.can_access_task(task_id));
create policy "task_people_delete" on taskapp.task_people
  for delete to authenticated using (taskapp.can_access_task(task_id));

-- task_categories 的策略不变：它用 owns_task，现在只认个人任务，组任务不能挂分类。

-- RLS：组、名单、邀请、投票 ---------------------------------------------------------------------

alter table taskapp.groups enable row level security;
alter table taskapp.group_members enable row level security;
alter table taskapp.group_invitations enable row level security;
alter table taskapp.group_deletion_requests enable row level security;
alter table taskapp.group_deletion_votes enable row level security;

create policy "groups_select_member" on taskapp.groups
  for select to authenticated using (taskapp.is_group_member(id));

create policy "group_members_select_member" on taskapp.group_members
  for select to authenticated using (taskapp.is_group_member(group_id));

-- 每个成员只能改自己在本组的昵称（列级授权只开放 nickname）
create policy "group_members_update_self" on taskapp.group_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 组里的成员看得到本组的邀请；被邀请的人看得到发给自己邮箱的邀请
create policy "group_invitations_select" on taskapp.group_invitations
  for select to authenticated
  using (
    taskapp.is_group_member(group_id)
    or email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "group_deletion_requests_select_member" on taskapp.group_deletion_requests
  for select to authenticated using (taskapp.is_group_member(group_id));

create policy "group_deletion_votes_select_member" on taskapp.group_deletion_votes
  for select to authenticated using (taskapp.is_group_member(group_id));

-- 其余写操作只通过下面的函数
revoke insert, update, delete on taskapp.groups, taskapp.group_members, taskapp.group_invitations,
  taskapp.group_deletion_requests, taskapp.group_deletion_votes from anon, authenticated;
grant select on taskapp.groups, taskapp.group_members, taskapp.group_invitations,
  taskapp.group_deletion_requests, taskapp.group_deletion_votes to authenticated;
grant update (nickname) on taskapp.group_members to authenticated;

-- 内部：删除组（连同组里的全部任务；任务的循环记录、人物、地点随任务级联删除）
create function taskapp.delete_group_now(p_group_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from taskapp.groups where id = p_group_id;
$$;

revoke execute on function taskapp.delete_group_now(uuid) from public, anon, authenticated;

-- 函数：建组 ------------------------------------------------------------------------------------

-- 创建者是组长。这一批只做合作组。
create function taskapp.create_group(p_name text)
returns taskapp.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group taskapp.groups;
begin
  if auth.uid() is null then
    raise exception '没有登录' using errcode = 'insufficient_privilege';
  end if;
  insert into taskapp.groups (kind, name, created_by)
  values ('cooperative', btrim(p_name), auth.uid())
  returning * into v_group;
  insert into taskapp.group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'leader');
  return v_group;
end;
$$;

-- 函数：名单 ------------------------------------------------------------------------------------

-- 本组名单：昵称没设过时显示他的 TaskApp 名字
create function taskapp.group_roster(p_group_id uuid)
returns table (
  user_id uuid,
  nickname text,
  has_custom_nickname boolean,
  is_me boolean,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id,
         coalesce(m.nickname, u.display_name),
         m.nickname is not null,
         m.user_id = auth.uid(),
         m.joined_at
  from taskapp.group_members m
  join taskapp.users u on u.id = m.user_id
  where m.group_id = p_group_id
    and taskapp.is_group_member(p_group_id)
  order by m.joined_at, m.user_id;
$$;

-- 函数：邀请 ------------------------------------------------------------------------------------

-- 组长按邮箱邀请。返回 invited / already_invited / already_member / self
create function taskapp.invite_to_group(p_group_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if not taskapp.is_group_member(p_group_id) then
    raise exception '不是这个组的成员' using errcode = 'insufficient_privilege';
  end if;
  if v_email = '' then
    raise exception '邮箱不能为空' using errcode = 'check_violation';
  end if;
  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    return 'self';
  end if;
  if exists (
    select 1 from taskapp.group_members m join taskapp.users u on u.id = m.user_id
    where m.group_id = p_group_id and lower(u.email) = v_email
  ) then
    return 'already_member';
  end if;
  insert into taskapp.group_invitations (group_id, email, invited_by)
  values (p_group_id, v_email, auth.uid())
  on conflict (group_id, email) do nothing;
  return case when found then 'invited' else 'already_invited' end;
end;
$$;

create function taskapp.accept_group_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id
  from taskapp.group_invitations
  where id = p_invitation_id and email = lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_group_id is null then
    raise exception '邀请不存在' using errcode = 'no_data_found';
  end if;
  -- 合作组里所有成员都是组长
  insert into taskapp.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'leader')
  on conflict (group_id, user_id) do nothing;
  delete from taskapp.group_invitations where id = p_invitation_id;
  return v_group_id;
end;
$$;

create function taskapp.decline_group_invitation(p_invitation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from taskapp.group_invitations
  where id = p_invitation_id and email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- 函数：删除组的投票 ----------------------------------------------------------------------------

-- 所有组长都同意（投了同意票）了就删除组
create function taskapp.finish_group_deletion_if_agreed(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from taskapp.group_deletion_requests where group_id = p_group_id)
     and not exists (
       select 1 from taskapp.group_members m
       where m.group_id = p_group_id and m.role = 'leader'
         and not exists (
           select 1 from taskapp.group_deletion_votes v
           where v.group_id = p_group_id and v.user_id = m.user_id
         )
     ) then
    perform taskapp.delete_group_now(p_group_id);
    return true;
  end if;
  return false;
end;
$$;

revoke execute on function taskapp.finish_group_deletion_if_agreed(uuid) from public, anon, authenticated;

-- 任何一位组长都可以发起删除，发起者算作同意。组里只有发起者一人时直接删除。
-- 返回 deleted / requested / already_requested
create function taskapp.request_group_deletion(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from taskapp.group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'leader'
  ) then
    raise exception '只有组长可以删除组' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from taskapp.group_deletion_requests where group_id = p_group_id) then
    return 'already_requested';
  end if;
  insert into taskapp.group_deletion_requests (group_id, initiated_by)
  values (p_group_id, auth.uid());
  insert into taskapp.group_deletion_votes (group_id, user_id)
  values (p_group_id, auth.uid());
  if taskapp.finish_group_deletion_if_agreed(p_group_id) then
    return 'deleted';
  end if;
  return 'requested';
end;
$$;

-- 其他组长投票：同意；或不同意（这次删除取消，以后可以重新发起）。
-- 返回 deleted / agreed / cancelled / no_request
create function taskapp.vote_group_deletion(p_group_id uuid, p_agree boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from taskapp.group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'leader'
  ) then
    raise exception '只有组长可以投票' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from taskapp.group_deletion_requests where group_id = p_group_id) then
    return 'no_request';
  end if;
  if not p_agree then
    delete from taskapp.group_deletion_requests where group_id = p_group_id;
    return 'cancelled';
  end if;
  insert into taskapp.group_deletion_votes (group_id, user_id)
  values (p_group_id, auth.uid())
  on conflict (group_id, user_id) do nothing;
  if taskapp.finish_group_deletion_if_agreed(p_group_id) then
    return 'deleted';
  end if;
  return 'agreed';
end;
$$;

-- 没有后台定时任务：任何成员打开 TaskApp 时调用，把自己所在组里发起满一周的删除执行掉
-- （一周内没有操作的组长算作同意）。返回删除的组数。
create function taskapp.process_expired_group_deletions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_count integer := 0;
begin
  for v_group_id in
    select r.group_id
    from taskapp.group_deletion_requests r
    where r.started_at <= taskapp.clock_now() - interval '7 days'
      and taskapp.is_group_member(r.group_id)
  loop
    perform taskapp.delete_group_now(v_group_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 函数：通知 ------------------------------------------------------------------------------------

-- 我的通知：发给我邮箱的入组邀请；我所在组里、我还没投票的删除组投票
create function taskapp.my_notifications()
returns table (
  kind text,
  id uuid,
  group_id uuid,
  group_name text,
  actor_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'group_invitation', i.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), i.created_at
  from taskapp.group_invitations i
  join taskapp.groups g on g.id = i.group_id
  join taskapp.users u on u.id = i.invited_by
  left join taskapp.group_members m on m.group_id = i.group_id and m.user_id = i.invited_by
  where auth.uid() is not null
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  union all
  select 'group_deletion_vote', r.group_id, g.id, g.name,
         coalesce(m.nickname, u.display_name), r.started_at
  from taskapp.group_deletion_requests r
  join taskapp.groups g on g.id = r.group_id
  join taskapp.users u on u.id = r.initiated_by
  left join taskapp.group_members m on m.group_id = r.group_id and m.user_id = r.initiated_by
  where taskapp.is_group_member(r.group_id)
    and not exists (
      select 1 from taskapp.group_deletion_votes v
      where v.group_id = r.group_id and v.user_id = auth.uid()
    )
  order by 6 desc;
$$;

-- 打开通知：记下时间，之前的通知都算已读
create function taskapp.mark_notifications_seen()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update taskapp.users set notifications_seen_at = taskapp.clock_now()
  where id = auth.uid()
  returning notifications_seen_at;
$$;

grant execute on function
  taskapp.clock_now(),
  taskapp.is_group_member(uuid),
  taskapp.can_access_task(uuid),
  taskapp.create_group(text),
  taskapp.group_roster(uuid),
  taskapp.invite_to_group(uuid, text),
  taskapp.accept_group_invitation(uuid),
  taskapp.decline_group_invitation(uuid),
  taskapp.request_group_deletion(uuid),
  taskapp.vote_group_deletion(uuid, boolean),
  taskapp.process_expired_group_deletions(),
  taskapp.my_notifications(),
  taskapp.mark_notifications_seen()
to authenticated;

-- ==== 20261002000010_management_groups.sql ====

-- 管理组。
--
-- 在合作组的基础上增加第二种组：管理组。
--   身份：组长（人数不限，不能被撤销）/ 管理员 / 组员。被邀请加入的人是组员。
--   组长：删除组（全体组长投票）、任命新组长（全体组长投票）、任命和撤销管理员、
--         踢出管理员和组员，以及管理员的一切权限。
--   管理员：建、改（含设定 RACI）、删任务；邀请新成员；踢出组员；添加和删除只有名字的人。
--   组员：只能做 RACI 允许的事（R 标记完成，A 确认完成或不通过）。
-- 合作组的规则不变（人人都是组长，对每条任务都是 R 和 A），另外允许退出。
--
-- 所有任务多一个"已确认"的时间：个人任务和合作组任务完成的同时就是已确认；
-- 管理组里 R 标记完成后进入"待确认"，A 确认后才算已完成。循环任务这一轮不需要 A 确认。
--
-- 这些规则都在数据库里生效（函数、触发器、RLS），前端只是按同样的规则显示可用的操作。

-- 组：颜色 -------------------------------------------------------------------------------------

alter table taskapp.groups
  add column color text
  constraint groups_color_format check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

-- 身份：组长 / 管理员 / 组员 ------------------------------------------------------------------

alter table taskapp.group_members drop constraint group_members_role_check;
alter table taskapp.group_members
  add constraint group_members_role_check check (role in ('leader', 'admin', 'member'));
alter table taskapp.group_members alter column role set default 'member';

-- 当前用户在这个组里的身份；不是成员时为 null
create function taskapp.my_group_role(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from taskapp.group_members
  where group_id = p_group_id and user_id = auth.uid();
$$;

create function taskapp.group_kind(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select kind from taskapp.groups where id = p_group_id;
$$;

-- 能不能建任务、编辑任务内容、删任务：合作组的成员；管理组的组长和管理员
create function taskapp.can_manage_group_tasks(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case taskapp.group_kind(p_group_id)
    when 'cooperative' then taskapp.my_group_role(p_group_id) is not null
    when 'management' then coalesce(taskapp.my_group_role(p_group_id) in ('leader', 'admin'), false)
    else false
  end;
$$;

-- 能不能编辑这条任务的内容（标题、描述、时间、循环、人物、地点）
create function taskapp.can_edit_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t
    where t.id = p_task_id
      and (
        (t.group_id is null and t.owner_id = auth.uid())
        or (t.group_id is not null and taskapp.can_manage_group_tasks(t.group_id))
      )
  );
$$;

-- 只有名字的人（不是 TaskApp 用户）：只用在 RACI 的 C 和 I 上 -------------------------------

create table taskapp.group_contacts (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references taskapp.groups (id) on delete cascade,
  name       text not null
             constraint group_contacts_name_not_blank check (btrim(name) <> ''),
  created_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default now()
);

create index group_contacts_group_id_idx on taskapp.group_contacts (group_id);

-- RACI ----------------------------------------------------------------------------------------
-- 每条任务每个字母不限人数。R、A 必须是组内成员；C、I 可以是成员，也可以是只有名字的人。

create table taskapp.task_assignments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references taskapp.tasks (id) on delete cascade,
  role       text not null
             constraint task_assignments_role_check check (role in ('R', 'A', 'C', 'I')),
  user_id    uuid references taskapp.users (id),
  contact_id uuid references taskapp.group_contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint task_assignments_one_target check ((user_id is null) <> (contact_id is null)),
  constraint task_assignments_ra_members check (role in ('C', 'I') or user_id is not null)
);

create unique index task_assignments_user_key
  on taskapp.task_assignments (task_id, role, user_id) where user_id is not null;
create unique index task_assignments_contact_key
  on taskapp.task_assignments (task_id, role, contact_id) where contact_id is not null;
create index task_assignments_user_id_idx on taskapp.task_assignments (user_id);

create function taskapp.has_task_role(p_task_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.task_assignments
    where task_id = p_task_id and role = p_role and user_id = auth.uid()
  );
$$;

-- 完成确认 -------------------------------------------------------------------------------------

alter table taskapp.tasks add column confirmed_at timestamptz;
update taskapp.tasks set confirmed_at = completed_at where completed_at is not null;
alter table taskapp.tasks
  add constraint tasks_confirmed_requires_completed
  check (confirmed_at is null or completed_at is not null);

comment on column taskapp.tasks.confirmed_at is
  '已确认的时间。个人任务、合作组任务完成即确认；管理组任务由 A 确认（completed_at 有值而它为空 = 待确认）';

-- 任务的写入规则（组任务按组的类型）：
--   个人、合作组：完成即确认
--   管理组：内容只有组长、管理员能改；只有 R 能标记完成（R 同时是 A，或任务没有 A 时直接算已完成，
--           否则进入待确认）；A 确认；R 或 A 能取消完成（A 在待确认时取消 = 不通过）
create function taskapp.tasks_completion_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_is_r boolean;
  v_is_a boolean;
  v_has_a boolean;
begin
  if new.group_id is not null then
    select kind into v_kind from taskapp.groups where id = new.group_id;
  end if;

  if v_kind is distinct from 'management' then
    new.confirmed_at := new.completed_at;
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- 新任务还没有 RACI，不能直接带着完成状态
    new.completed_at := null;
    new.confirmed_at := null;
    return new;
  end if;

  -- 没有登录身份（控制台里的维护操作）不做身份检查
  if auth.uid() is null then
    return new;
  end if;

  if (new.title, new.description, new.deadline_at, new.recurrence_rule, new.recurrence_dtstart,
      new.deleted_at, new.owner_id)
     is distinct from
     (old.title, old.description, old.deadline_at, old.recurrence_rule, old.recurrence_dtstart,
      old.deleted_at, old.owner_id)
     and not taskapp.can_manage_group_tasks(new.group_id) then
    raise exception '只有组长和管理员可以编辑任务' using errcode = 'insufficient_privilege';
  end if;

  v_is_r := taskapp.has_task_role(new.id, 'R');
  v_is_a := taskapp.has_task_role(new.id, 'A');
  v_has_a := exists (select 1 from taskapp.task_assignments where task_id = new.id and role = 'A');

  if old.completed_at is null and new.completed_at is not null then
    if not v_is_r then
      raise exception '只有 R 可以标记完成' using errcode = 'insufficient_privilege';
    end if;
    new.confirmed_at := case when v_is_a or not v_has_a then new.completed_at end;
  elsif old.completed_at is not null and new.completed_at is null then
    if not (v_is_r or v_is_a) then
      raise exception '只有 R 或 A 可以取消完成' using errcode = 'insufficient_privilege';
    end if;
    new.confirmed_at := null;
  elsif new.confirmed_at is distinct from old.confirmed_at then
    if not v_is_a or new.completed_at is null or new.confirmed_at is null then
      raise exception '只有 A 可以确认完成' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_completion_rules
  before insert or update on taskapp.tasks
  for each row execute function taskapp.tasks_completion_rules();

-- 建任务：管理组只有组长和管理员
drop policy "tasks_insert" on taskapp.tasks;
create policy "tasks_insert" on taskapp.tasks
  for insert to authenticated
  with check (
    owner_id = (select taskapp.current_owner_id())
    and (group_id is null or taskapp.can_manage_group_tasks(group_id))
  );

-- 人物、地点属于任务内容：管理组里只有组长和管理员能改
drop policy "task_locations_insert" on taskapp.task_locations;
drop policy "task_locations_update" on taskapp.task_locations;
drop policy "task_locations_delete" on taskapp.task_locations;
create policy "task_locations_insert" on taskapp.task_locations
  for insert to authenticated with check (taskapp.can_edit_task(task_id));
create policy "task_locations_update" on taskapp.task_locations
  for update to authenticated
  using (taskapp.can_edit_task(task_id)) with check (taskapp.can_edit_task(task_id));
create policy "task_locations_delete" on taskapp.task_locations
  for delete to authenticated using (taskapp.can_edit_task(task_id));

drop policy "task_people_insert" on taskapp.task_people;
drop policy "task_people_update" on taskapp.task_people;
drop policy "task_people_delete" on taskapp.task_people;
create policy "task_people_insert" on taskapp.task_people
  for insert to authenticated with check (taskapp.can_edit_task(task_id));
create policy "task_people_update" on taskapp.task_people
  for update to authenticated
  using (taskapp.can_edit_task(task_id)) with check (taskapp.can_edit_task(task_id));
create policy "task_people_delete" on taskapp.task_people
  for delete to authenticated using (taskapp.can_edit_task(task_id));

-- 循环任务：管理组里只有 R 能完成（或取消完成）某一次；这一轮不需要 A 确认。
-- 其余状态（待定、已错过）由打开任务的人顺带归档，不检查身份。
create function taskapp.occurrence_completion_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (new.status = 'completed') is distinct from
     (tg_op = 'UPDATE' and old.status = 'completed')
     and exists (
       select 1 from taskapp.tasks t join taskapp.groups g on g.id = t.group_id
       where t.id = new.task_id and g.kind = 'management'
     )
     and not taskapp.has_task_role(new.task_id, 'R') then
    raise exception '只有 R 可以完成这一次' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger occurrence_completion_rules
  before insert or update on taskapp.recurrence_occurrences
  for each row execute function taskapp.occurrence_completion_rules();

-- 任务通知 -------------------------------------------------------------------------------------
--   task_assigned：被标成 R；task_completed：R 标记完成、等 A 确认；
--   task_rejected：A 点了不通过；task_changed：任务状态或内容有变化（给组内成员里的 I）

create table taskapp.task_notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references taskapp.users (id),
  kind         text not null
               constraint task_notifications_kind_check
               check (kind in ('task_assigned', 'task_completed', 'task_rejected', 'task_changed')),
  task_id      uuid not null references taskapp.tasks (id) on delete cascade,
  actor_id     uuid references taskapp.users (id),
  created_at   timestamptz not null default taskapp.clock_now(),
  dismissed_at timestamptz
);

create index task_notifications_user_idx
  on taskapp.task_notifications (user_id) where dismissed_at is null;

-- 内部：发一条任务通知（不发给操作者自己）。同一个人、同一条任务、同一种通知在处理掉之前只保留一条，
-- 再次发生时更新时间和操作者（例如任务连续改了几次、不通过后又标记完成）
create function taskapp.notify_task(p_user_id uuid, p_kind text, p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id = auth.uid() then
    return;
  end if;
  update taskapp.task_notifications
  set created_at = taskapp.clock_now(), actor_id = auth.uid()
  where user_id = p_user_id and task_id = p_task_id and kind = p_kind
    and dismissed_at is null;
  if found then
    return;
  end if;
  insert into taskapp.task_notifications (user_id, kind, task_id, actor_id)
  values (p_user_id, p_kind, p_task_id, auth.uid());
end;
$$;

create function taskapp.tasks_notify_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if new.group_id is null or taskapp.group_kind(new.group_id) <> 'management' then
    return null;
  end if;

  -- R 标记完成、进入待确认：通知 A
  if old.completed_at is null and new.completed_at is not null and new.confirmed_at is null then
    for v_user in
      select user_id from taskapp.task_assignments where task_id = new.id and role = 'A'
    loop
      perform taskapp.notify_task(v_user, 'task_completed', new.id);
    end loop;
  end if;

  -- A 不通过（待确认时取消完成，操作者不是 R）：通知 R
  if old.completed_at is not null and old.confirmed_at is null and new.completed_at is null
     and taskapp.has_task_role(new.id, 'A') and not taskapp.has_task_role(new.id, 'R') then
    for v_user in
      select user_id from taskapp.task_assignments where task_id = new.id and role = 'R'
    loop
      perform taskapp.notify_task(v_user, 'task_rejected', new.id);
    end loop;
  end if;

  -- 状态或内容有变化：通知组内成员里的 I
  if (new.title, new.description, new.deadline_at, new.recurrence_rule, new.recurrence_dtstart,
      new.deleted_at, new.completed_at, new.confirmed_at)
     is distinct from
     (old.title, old.description, old.deadline_at, old.recurrence_rule, old.recurrence_dtstart,
      old.deleted_at, old.completed_at, old.confirmed_at) then
    for v_user in
      select user_id from taskapp.task_assignments
      where task_id = new.id and role = 'I' and user_id is not null
    loop
      perform taskapp.notify_task(v_user, 'task_changed', new.id);
    end loop;
  end if;
  return null;
end;
$$;

create trigger tasks_notify_changes
  after update on taskapp.tasks
  for each row execute function taskapp.tasks_notify_changes();

-- 任命新组长的投票 ------------------------------------------------------------------------------
-- 发起的组长算同意；任何一位组长不同意就取消；三天内不操作算同意。

create table taskapp.group_leader_requests (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references taskapp.groups (id) on delete cascade,
  candidate_id uuid not null references taskapp.users (id),
  initiated_by uuid not null references taskapp.users (id),
  started_at   timestamptz not null default taskapp.clock_now(),
  unique (group_id, candidate_id)
);

create table taskapp.group_leader_votes (
  request_id uuid not null references taskapp.group_leader_requests (id) on delete cascade,
  user_id    uuid not null references taskapp.users (id),
  voted_at   timestamptz not null default taskapp.clock_now(),
  primary key (request_id, user_id)
);

-- RLS ------------------------------------------------------------------------------------------

alter table taskapp.group_contacts enable row level security;
alter table taskapp.task_assignments enable row level security;
alter table taskapp.task_notifications enable row level security;
alter table taskapp.group_leader_requests enable row level security;
alter table taskapp.group_leader_votes enable row level security;

create policy "group_contacts_select_member" on taskapp.group_contacts
  for select to authenticated using (taskapp.is_group_member(group_id));

-- 组里所有成员都能看到每条任务上的 RACI
create policy "task_assignments_select" on taskapp.task_assignments
  for select to authenticated using (taskapp.can_access_task(task_id));

create policy "task_notifications_select_own" on taskapp.task_notifications
  for select to authenticated using (user_id = auth.uid());

create policy "group_leader_requests_select_member" on taskapp.group_leader_requests
  for select to authenticated using (taskapp.is_group_member(group_id));

create policy "group_leader_votes_select_member" on taskapp.group_leader_votes
  for select to authenticated
  using (exists (
    select 1 from taskapp.group_leader_requests r
    where r.id = request_id and taskapp.is_group_member(r.group_id)
  ));

-- 写操作只通过下面的函数
revoke insert, update, delete on taskapp.group_contacts, taskapp.task_assignments,
  taskapp.task_notifications, taskapp.group_leader_requests, taskapp.group_leader_votes
  from anon, authenticated;
grant select on taskapp.group_contacts, taskapp.task_assignments, taskapp.task_notifications,
  taskapp.group_leader_requests, taskapp.group_leader_votes to authenticated;

-- 函数：建组（可选合作组或管理组）、改组名和颜色 -----------------------------------------------

create function taskapp.create_group_v2(p_name text, p_kind text, p_color text)
returns taskapp.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group taskapp.groups;
begin
  if auth.uid() is null then
    raise exception '没有登录' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('cooperative', 'management') then
    raise exception '目前只能建合作组或管理组' using errcode = 'check_violation';
  end if;
  insert into taskapp.groups (kind, name, color, created_by)
  values (p_kind, btrim(p_name), p_color, auth.uid())
  returning * into v_group;
  insert into taskapp.group_members (group_id, user_id, role)
  values (v_group.id, auth.uid(), 'leader');
  return v_group;
end;
$$;

-- 组名和颜色：只有组长能改
create function taskapp.update_group(p_group_id uuid, p_name text, p_color text)
returns taskapp.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group taskapp.groups;
begin
  if taskapp.my_group_role(p_group_id) is distinct from 'leader' then
    raise exception '只有组长可以修改组名和颜色' using errcode = 'insufficient_privilege';
  end if;
  update taskapp.groups set name = btrim(p_name), color = p_color
  where id = p_group_id
  returning * into v_group;
  return v_group;
end;
$$;

-- 函数：名单（多了身份和邮箱） -----------------------------------------------------------------

drop function taskapp.group_roster(uuid);
create function taskapp.group_roster(p_group_id uuid)
returns table (
  user_id uuid,
  nickname text,
  has_custom_nickname boolean,
  is_me boolean,
  joined_at timestamptz,
  role text,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id,
         coalesce(m.nickname, u.display_name),
         m.nickname is not null,
         m.user_id = auth.uid(),
         m.joined_at,
         m.role,
         u.email
  from taskapp.group_members m
  join taskapp.users u on u.id = m.user_id
  where m.group_id = p_group_id
    and taskapp.is_group_member(p_group_id)
  order by m.joined_at, m.user_id;
$$;

-- 邀请：合作组的成员都能邀请；管理组只有组长和管理员。被邀请的人在管理组里是组员。
create or replace function taskapp.invite_to_group(p_group_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if not taskapp.can_manage_group_tasks(p_group_id) then
    raise exception '没有邀请的权限' using errcode = 'insufficient_privilege';
  end if;
  if v_email = '' then
    raise exception '邮箱不能为空' using errcode = 'check_violation';
  end if;
  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    return 'self';
  end if;
  if exists (
    select 1 from taskapp.group_members m join taskapp.users u on u.id = m.user_id
    where m.group_id = p_group_id and lower(u.email) = v_email
  ) then
    return 'already_member';
  end if;
  insert into taskapp.group_invitations (group_id, email, invited_by)
  values (p_group_id, v_email, auth.uid())
  on conflict (group_id, email) do nothing;
  return case when found then 'invited' else 'already_invited' end;
end;
$$;

create or replace function taskapp.accept_group_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id
  from taskapp.group_invitations
  where id = p_invitation_id and email = lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_group_id is null then
    raise exception '邀请不存在' using errcode = 'no_data_found';
  end if;
  -- 合作组里所有成员都是组长；管理组里被邀请的人是组员
  insert into taskapp.group_members (group_id, user_id, role)
  values (
    v_group_id,
    auth.uid(),
    case taskapp.group_kind(v_group_id) when 'cooperative' then 'leader' else 'member' end
  )
  on conflict (group_id, user_id) do nothing;
  delete from taskapp.group_invitations where id = p_invitation_id;
  return v_group_id;
end;
$$;

-- 函数：只有名字的人（管理组的组长和管理员） ---------------------------------------------------

create function taskapp.add_group_contact(p_group_id uuid, p_name text)
returns taskapp.group_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact taskapp.group_contacts;
begin
  if taskapp.group_kind(p_group_id) <> 'management'
     or not taskapp.can_manage_group_tasks(p_group_id) then
    raise exception '没有添加的权限' using errcode = 'insufficient_privilege';
  end if;
  insert into taskapp.group_contacts (group_id, name, created_by)
  values (p_group_id, btrim(p_name), auth.uid())
  returning * into v_contact;
  return v_contact;
end;
$$;

-- 删除只有名字的人：他在任务上的 C、I 一并去掉
create function taskapp.remove_group_contact(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from taskapp.group_contacts where id = p_contact_id;
  if v_group_id is null or not taskapp.can_manage_group_tasks(v_group_id) then
    raise exception '没有删除的权限' using errcode = 'insufficient_privilege';
  end if;
  delete from taskapp.group_contacts where id = p_contact_id;
end;
$$;

-- 函数：设定 RACI（管理组的组长和管理员；整组替换） ---------------------------------------------
-- p_assignments: [{"role": "R", "user_id": "..."} | {"role": "C", "contact_id": "..."}]

create function taskapp.set_task_raci(p_task_id uuid, p_assignments jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_old_r uuid[];
  v_user uuid;
  v_item jsonb;
begin
  select group_id into v_group_id from taskapp.tasks where id = p_task_id;
  if v_group_id is null or taskapp.group_kind(v_group_id) <> 'management' then
    raise exception '只有管理组的任务有 RACI' using errcode = 'check_violation';
  end if;
  if not taskapp.can_manage_group_tasks(v_group_id) then
    raise exception '只有组长和管理员可以设定 RACI' using errcode = 'insufficient_privilege';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) loop
    if v_item ->> 'user_id' is not null and not exists (
      select 1 from taskapp.group_members
      where group_id = v_group_id and user_id = (v_item ->> 'user_id')::uuid
    ) then
      raise exception 'RACI 里的成员必须是组内成员' using errcode = 'check_violation';
    end if;
    if v_item ->> 'contact_id' is not null and not exists (
      select 1 from taskapp.group_contacts
      where group_id = v_group_id and id = (v_item ->> 'contact_id')::uuid
    ) then
      raise exception '只有名字的人不在这个组里' using errcode = 'check_violation';
    end if;
  end loop;

  select coalesce(array_agg(user_id), '{}') into v_old_r
  from taskapp.task_assignments where task_id = p_task_id and role = 'R';

  delete from taskapp.task_assignments where task_id = p_task_id;
  insert into taskapp.task_assignments (task_id, role, user_id, contact_id)
  select distinct p_task_id, x ->> 'role', (x ->> 'user_id')::uuid, (x ->> 'contact_id')::uuid
  from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) x;

  -- 新标成 R 的人收到"分配给你"
  for v_user in
    select user_id from taskapp.task_assignments
    where task_id = p_task_id and role = 'R' and not (user_id = any (v_old_r))
  loop
    perform taskapp.notify_task(v_user, 'task_assigned', p_task_id);
  end loop;
end;
$$;

-- 函数：身份 ------------------------------------------------------------------------------------

-- 任命和撤销管理员：只有组长；组长不能被撤销
create function taskapp.set_group_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if taskapp.group_kind(p_group_id) <> 'management'
     or taskapp.my_group_role(p_group_id) is distinct from 'leader' then
    raise exception '只有组长可以任命或撤销管理员' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception '任命组长要全体组长投票' using errcode = 'check_violation';
  end if;
  update taskapp.group_members set role = p_role
  where group_id = p_group_id and user_id = p_user_id and role <> 'leader';
  if not found then
    raise exception '组长不能被撤销' using errcode = 'check_violation';
  end if;
end;
$$;

-- 内部：全体组长都同意了就任命
create function taskapp.finish_leader_request_if_agreed(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request taskapp.group_leader_requests;
begin
  select * into v_request from taskapp.group_leader_requests where id = p_request_id;
  if v_request.id is null then
    return false;
  end if;
  if exists (
    select 1 from taskapp.group_members m
    where m.group_id = v_request.group_id and m.role = 'leader'
      and not exists (
        select 1 from taskapp.group_leader_votes v
        where v.request_id = p_request_id and v.user_id = m.user_id
      )
  ) then
    return false;
  end if;
  update taskapp.group_members set role = 'leader'
  where group_id = v_request.group_id and user_id = v_request.candidate_id;
  delete from taskapp.group_leader_requests where id = p_request_id;
  return true;
end;
$$;

-- 发起任命新组长。返回 appointed（只有发起者一位组长时直接任命）/ requested / already_requested
create function taskapp.request_leader_appointment(p_group_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if taskapp.group_kind(p_group_id) <> 'management'
     or taskapp.my_group_role(p_group_id) is distinct from 'leader' then
    raise exception '只有组长可以任命新组长' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from taskapp.group_members
    where group_id = p_group_id and user_id = p_user_id and role <> 'leader'
  ) then
    raise exception '只能任命组里的管理员或组员' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from taskapp.group_leader_requests
    where group_id = p_group_id and candidate_id = p_user_id
  ) then
    return 'already_requested';
  end if;
  insert into taskapp.group_leader_requests (group_id, candidate_id, initiated_by)
  values (p_group_id, p_user_id, auth.uid())
  returning id into v_request_id;
  insert into taskapp.group_leader_votes (request_id, user_id) values (v_request_id, auth.uid());
  if taskapp.finish_leader_request_if_agreed(v_request_id) then
    return 'appointed';
  end if;
  return 'requested';
end;
$$;

-- 其他组长投票。返回 appointed / agreed / cancelled / no_request
create function taskapp.vote_leader_appointment(p_request_id uuid, p_agree boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from taskapp.group_leader_requests where id = p_request_id;
  if v_group_id is null then
    return 'no_request';
  end if;
  if taskapp.my_group_role(v_group_id) is distinct from 'leader' then
    raise exception '只有组长可以投票' using errcode = 'insufficient_privilege';
  end if;
  if not p_agree then
    delete from taskapp.group_leader_requests where id = p_request_id;
    return 'cancelled';
  end if;
  insert into taskapp.group_leader_votes (request_id, user_id)
  values (p_request_id, auth.uid())
  on conflict do nothing;
  if taskapp.finish_leader_request_if_agreed(p_request_id) then
    return 'appointed';
  end if;
  return 'agreed';
end;
$$;

-- 函数：踢出与退出 ------------------------------------------------------------------------------

-- 某人在本组所有（未删除的）任务上的 R、A、C、I
create function taskapp.member_task_roles(p_group_id uuid, p_user_id uuid)
returns table (task_id uuid, task_title text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, a.role
  from taskapp.task_assignments a
  join taskapp.tasks t on t.id = a.task_id
  where taskapp.is_group_member(p_group_id)
    and t.group_id = p_group_id and t.deleted_at is null and a.user_id = p_user_id
  order by t.title, t.id, position(a.role in 'RACI');
$$;

-- 内部：把某人移出组（他身上的 C、I 一并去掉；他的投票作废；以他为候选人的任命取消），
-- 然后看剩下的组长是不是都同意了正在进行的投票
create function taskapp.remove_member_now(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  delete from taskapp.task_assignments a
  using taskapp.tasks t
  where t.id = a.task_id and t.group_id = p_group_id and a.user_id = p_user_id;
  delete from taskapp.group_leader_requests
  where group_id = p_group_id and candidate_id = p_user_id;
  delete from taskapp.group_leader_votes v
  using taskapp.group_leader_requests r
  where r.id = v.request_id and r.group_id = p_group_id and v.user_id = p_user_id;
  delete from taskapp.group_deletion_votes where group_id = p_group_id and user_id = p_user_id;
  delete from taskapp.group_members where group_id = p_group_id and user_id = p_user_id;

  if not exists (select 1 from taskapp.group_members where group_id = p_group_id) then
    perform taskapp.delete_group_now(p_group_id);
    return;
  end if;
  if taskapp.finish_group_deletion_if_agreed(p_group_id) then
    return;
  end if;
  for v_request_id in
    select id from taskapp.group_leader_requests where group_id = p_group_id
  loop
    perform taskapp.finish_leader_request_if_agreed(v_request_id);
  end loop;
end;
$$;

-- 身上有没有 R 或 A（未删除的任务）
create function taskapp.has_ra_in_group(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.task_assignments a
    join taskapp.tasks t on t.id = a.task_id
    where t.group_id = p_group_id and t.deleted_at is null
      and a.user_id = p_user_id and a.role in ('R', 'A')
  );
$$;

-- 踢出（管理组）：组长能踢管理员和组员，管理员能踢组员；组长不能被踢。
-- 身上有 R 或 A 时不执行，返回 blocked；否则返回 removed
create function taskapp.remove_group_member(p_group_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role text := taskapp.my_group_role(p_group_id);
  v_target_role text;
begin
  select role into v_target_role from taskapp.group_members
  where group_id = p_group_id and user_id = p_user_id;
  if taskapp.group_kind(p_group_id) <> 'management' or v_target_role is null
     or p_user_id = auth.uid()
     or not (
       (v_my_role = 'leader' and v_target_role in ('admin', 'member'))
       or (v_my_role = 'admin' and v_target_role = 'member')
     ) then
    raise exception '没有踢出这个人的权限' using errcode = 'insufficient_privilege';
  end if;
  if taskapp.has_ra_in_group(p_group_id, p_user_id) then
    return 'blocked';
  end if;
  perform taskapp.remove_member_now(p_group_id, p_user_id);
  return 'removed';
end;
$$;

-- 退出。返回 left / deleted（合作组最后一个成员退出，组和任务一起删除）/
-- blocked（管理组里身上有 R 或 A）/ last_leader（管理组最后一位组长）
create function taskapp.leave_group(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := taskapp.my_group_role(p_group_id);
begin
  if v_role is null then
    raise exception '不是这个组的成员' using errcode = 'insufficient_privilege';
  end if;
  if taskapp.group_kind(p_group_id) = 'management' then
    if taskapp.has_ra_in_group(p_group_id, auth.uid()) then
      return 'blocked';
    end if;
    if v_role = 'leader' and not exists (
      select 1 from taskapp.group_members
      where group_id = p_group_id and role = 'leader' and user_id <> auth.uid()
    ) then
      return 'last_leader';
    end if;
  end if;
  perform taskapp.remove_member_now(p_group_id, auth.uid());
  if not exists (select 1 from taskapp.groups where id = p_group_id) then
    return 'deleted';
  end if;
  return 'left';
end;
$$;

-- 删除组的投票：管理组里只有组长投票（finish_group_deletion_if_agreed 只看组长，不变）

-- 超时：没有后台定时任务，任何成员打开 TaskApp 时调用 ------------------------------------------
--   删除组：一周内没有操作的组长算同意；任命组长：三天内没有操作的组长算同意

create function taskapp.process_group_timeouts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_request taskapp.group_leader_requests;
begin
  v_count := taskapp.process_expired_group_deletions();
  for v_request in
    select * from taskapp.group_leader_requests r
    where r.started_at <= taskapp.clock_now() - interval '3 days'
      and taskapp.is_group_member(r.group_id)
  loop
    update taskapp.group_members set role = 'leader'
    where group_id = v_request.group_id and user_id = v_request.candidate_id;
    delete from taskapp.group_leader_requests where id = v_request.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 函数：通知 ------------------------------------------------------------------------------------

drop function taskapp.my_notifications();
create function taskapp.my_notifications()
returns table (
  kind text,
  id uuid,
  group_id uuid,
  group_name text,
  actor_name text,
  created_at timestamptz,
  task_id uuid,
  task_title text,
  subject_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- 入组邀请
  select 'group_invitation', i.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), i.created_at,
         null::uuid, null::text, null::text
  from taskapp.group_invitations i
  join taskapp.groups g on g.id = i.group_id
  join taskapp.users u on u.id = i.invited_by
  left join taskapp.group_members m on m.group_id = i.group_id and m.user_id = i.invited_by
  where auth.uid() is not null
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  union all
  -- 删除组的投票（我是组长、还没投）
  select 'group_deletion_vote', r.group_id, g.id, g.name,
         coalesce(m.nickname, u.display_name), r.started_at,
         null, null, null
  from taskapp.group_deletion_requests r
  join taskapp.groups g on g.id = r.group_id
  join taskapp.users u on u.id = r.initiated_by
  left join taskapp.group_members m on m.group_id = r.group_id and m.user_id = r.initiated_by
  where taskapp.my_group_role(r.group_id) = 'leader'
    and not exists (
      select 1 from taskapp.group_deletion_votes v
      where v.group_id = r.group_id and v.user_id = auth.uid()
    )
  union all
  -- 任命组长的投票（我是组长、还没投）
  select 'group_leader_vote', r.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), r.started_at,
         null, null, coalesce(cm.nickname, cu.display_name)
  from taskapp.group_leader_requests r
  join taskapp.groups g on g.id = r.group_id
  join taskapp.users u on u.id = r.initiated_by
  left join taskapp.group_members m on m.group_id = r.group_id and m.user_id = r.initiated_by
  join taskapp.users cu on cu.id = r.candidate_id
  left join taskapp.group_members cm on cm.group_id = r.group_id and cm.user_id = r.candidate_id
  where taskapp.my_group_role(r.group_id) = 'leader'
    and not exists (
      select 1 from taskapp.group_leader_votes v
      where v.request_id = r.id and v.user_id = auth.uid()
    )
  union all
  -- 任务通知（我还在这个组里、任务没删除；"等你确认"只在任务还待确认时显示）
  select n.kind, n.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), n.created_at,
         t.id, t.title, null
  from taskapp.task_notifications n
  join taskapp.tasks t on t.id = n.task_id
  join taskapp.groups g on g.id = t.group_id
  left join taskapp.users u on u.id = n.actor_id
  left join taskapp.group_members m on m.group_id = g.id and m.user_id = n.actor_id
  where n.user_id = auth.uid()
    and n.dismissed_at is null
    and t.deleted_at is null
    and taskapp.is_group_member(g.id)
    and (n.kind <> 'task_completed' or (t.completed_at is not null and t.confirmed_at is null))
  order by 6 desc;
$$;

-- 看过 / 处理过的任务通知不再显示
create function taskapp.dismiss_notification(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update taskapp.task_notifications set dismissed_at = taskapp.clock_now()
  where id = p_id and user_id = auth.uid();
$$;

-- 内部函数不对外开放 ---------------------------------------------------------------------------

revoke execute on function
  taskapp.notify_task(uuid, text, uuid),
  taskapp.finish_leader_request_if_agreed(uuid),
  taskapp.remove_member_now(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  taskapp.my_group_role(uuid),
  taskapp.group_kind(uuid),
  taskapp.can_manage_group_tasks(uuid),
  taskapp.can_edit_task(uuid),
  taskapp.has_task_role(uuid, text),
  taskapp.has_ra_in_group(uuid, uuid),
  taskapp.create_group_v2(text, text, text),
  taskapp.update_group(uuid, text, text),
  taskapp.group_roster(uuid),
  taskapp.add_group_contact(uuid, text),
  taskapp.remove_group_contact(uuid),
  taskapp.set_task_raci(uuid, jsonb),
  taskapp.set_group_member_role(uuid, uuid, text),
  taskapp.request_leader_appointment(uuid, uuid),
  taskapp.vote_leader_appointment(uuid, boolean),
  taskapp.member_task_roles(uuid, uuid),
  taskapp.remove_group_member(uuid, uuid),
  taskapp.leave_group(uuid),
  taskapp.process_group_timeouts(),
  taskapp.my_notifications(),
  taskapp.dismiss_notification(uuid)
to authenticated;

-- ==== 20261003000011_notifications_and_raci_rules.sql ====

-- 通知改进、管理组任务必须有执行人和负责人、颜色可以重复。
--
-- 1. 分类的颜色可以重复（组的颜色本来就可以重复）。
-- 2. 管理组的任务必须至少有一个执行人（R）和一个负责人（A）：建任务时一起设定（create_task_with_raci），
--    之后改 RACI 也不能删到一个都不剩。检查放在事务提交时（可延迟的约束触发器），
--    所以"先建任务、再设 RACI"必须在同一个事务里完成。
-- 3. 任务通知改成结构化的记录：操作者、动作、对象（被设的人）、任务、改动的字段；显示时再拼成句子。
--      动作      收到的人
--      assigned  被设为执行人的人、知会（I）
--      completed 负责人（A）、知会（I）
--      confirmed 执行人（R）、知会（I）
--      rejected  执行人（R）、知会（I）
--      modified  执行人（R）、知会（I）；改动的字段：title / description / deadline / recurrence /
--                deleted / restored / R / A / C / I / people / location
--    只发给组内成员（只有名字的人只是标注），不发给操作者自己。同一个人、同一条任务、同一种通知
--    （同一个动作和对象）在处理之前只保留一条，再次发生时合并改动的字段并更新时间。

-- 1. 颜色可以重复 ------------------------------------------------------------------------------

drop index if exists taskapp.categories_owner_color_key;

-- 2. 通知记录改成结构化 -------------------------------------------------------------------------

alter table taskapp.task_notifications
  add column action         text,
  add column target_user_id uuid references taskapp.users (id),
  add column fields         text[] not null default '{}';

update taskapp.task_notifications set
  action = case kind
    when 'task_assigned' then 'assigned'
    when 'task_completed' then 'completed'
    when 'task_rejected' then 'rejected'
    else 'modified'
  end,
  target_user_id = case when kind = 'task_assigned' then user_id end;

alter table taskapp.task_notifications drop column kind;
alter table taskapp.task_notifications alter column action set not null;
alter table taskapp.task_notifications
  add constraint task_notifications_action_check
  check (action in ('assigned', 'completed', 'confirmed', 'rejected', 'modified'));

-- 字段的固定顺序（合并改动的字段时按这个顺序排列）
create function taskapp.notification_field_order()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['title', 'description', 'deadline', 'recurrence', 'deleted', 'restored',
               'R', 'A', 'C', 'I', 'people', 'location'];
$$;

-- 内部：发一条任务通知。只发给组内成员，不发给操作者自己；同一个人、同一条任务、同一个动作和对象
-- 在处理之前只保留一条，再次发生时合并改动的字段、更新时间和操作者。
create function taskapp.notify_task_v2(
  p_user_id uuid,
  p_action text,
  p_task_id uuid,
  p_target uuid default null,
  p_fields text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id = auth.uid() then
    return;
  end if;
  if not exists (
    select 1 from taskapp.tasks t
    join taskapp.group_members m on m.group_id = t.group_id and m.user_id = p_user_id
    where t.id = p_task_id
  ) then
    return;
  end if;
  update taskapp.task_notifications n
  set created_at = taskapp.clock_now(),
      actor_id = auth.uid(),
      fields = (
        select coalesce(array_agg(f order by array_position(taskapp.notification_field_order(), f)), '{}')
        from (select distinct unnest(n.fields || p_fields) as f) merged
      )
  where n.user_id = p_user_id and n.task_id = p_task_id and n.action = p_action
    and n.target_user_id is not distinct from p_target
    and n.dismissed_at is null;
  if found then
    return;
  end if;
  insert into taskapp.task_notifications (user_id, action, task_id, actor_id, target_user_id, fields)
  values (p_user_id, p_action, p_task_id, auth.uid(), p_target, coalesce(p_fields, '{}'));
end;
$$;

-- 内部：通知任务上某几种身份的成员
create function taskapp.notify_task_roles(
  p_task_id uuid,
  p_roles text[],
  p_action text,
  p_target uuid default null,
  p_fields text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select distinct user_id from taskapp.task_assignments
    where task_id = p_task_id and role = any (p_roles) and user_id is not null
  loop
    perform taskapp.notify_task_v2(v_user, p_action, p_task_id, p_target, p_fields);
  end loop;
end;
$$;

-- 正在用 create_task_with_raci 新建的任务：建的时候设人物、地点不算"修改"
create function taskapp.is_creating_task(p_task_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('taskapp.creating_task', true), '') = p_task_id::text;
$$;

-- 任务本身的变化：完成、确认、退回、修改（标题、描述、截止时间、循环、删除 / 恢复）
create or replace function taskapp.tasks_notify_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if new.group_id is null or taskapp.group_kind(new.group_id) <> 'management' then
    return null;
  end if;

  if old.completed_at is null and new.completed_at is not null then
    perform taskapp.notify_task_roles(new.id, array['A', 'I'], 'completed');
  elsif old.confirmed_at is null and new.confirmed_at is not null and old.completed_at is not null then
    perform taskapp.notify_task_roles(new.id, array['R', 'I'], 'confirmed');
  elsif old.completed_at is not null and old.confirmed_at is null and new.completed_at is null
        and taskapp.has_task_role(new.id, 'A') and not taskapp.has_task_role(new.id, 'R') then
    perform taskapp.notify_task_roles(new.id, array['R', 'I'], 'rejected');
  end if;

  v_fields := array_remove(array[
    case when new.title is distinct from old.title then 'title' end,
    case when new.description is distinct from old.description then 'description' end,
    case when new.deadline_at is distinct from old.deadline_at then 'deadline' end,
    case when (new.recurrence_rule, new.recurrence_dtstart)
              is distinct from (old.recurrence_rule, old.recurrence_dtstart) then 'recurrence' end,
    case when old.deleted_at is null and new.deleted_at is not null then 'deleted'
         when old.deleted_at is not null and new.deleted_at is null then 'restored' end
  ], null);
  if cardinality(v_fields) > 0 then
    perform taskapp.notify_task_roles(new.id, array['R', 'I'], 'modified', null, v_fields);
  end if;
  return null;
end;
$$;

-- 人物、地点的变化（管理组）：通知执行人和知会
create function taskapp.task_extension_notify_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid := coalesce(new.task_id, old.task_id);
begin
  if taskapp.is_creating_task(v_task_id) or not exists (
    select 1 from taskapp.tasks t join taskapp.groups g on g.id = t.group_id
    where t.id = v_task_id and g.kind = 'management'
  ) then
    return null;
  end if;
  perform taskapp.notify_task_roles(
    v_task_id,
    array['R', 'I'],
    'modified',
    null,
    array[case when tg_table_name = 'task_people' then 'people' else 'location' end]
  );
  return null;
end;
$$;

create trigger task_people_notify_changes
  after insert or update or delete on taskapp.task_people
  for each row execute function taskapp.task_extension_notify_changes();
create trigger task_locations_notify_changes
  after insert or update or delete on taskapp.task_locations
  for each row execute function taskapp.task_extension_notify_changes();

-- 3. RACI：执行人和负责人必须有 ------------------------------------------------------------------

-- 内部：整组替换 RACI 并发通知。
--   新设的执行人：本人和知会收到"设为执行人"（对象是这个人）
--   其他字母有变化（或有执行人被去掉）：执行人和知会收到"修改"（改动的字段是这些字母）；新建任务时不发
create function taskapp.apply_task_raci(p_task_id uuid, p_assignments jsonb, p_is_new boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_item jsonb;
  v_before jsonb;
  v_after jsonb;
  v_role text;
  v_fields text[] := '{}';
  v_user uuid;
begin
  select group_id into v_group_id from taskapp.tasks where id = p_task_id;
  if v_group_id is null or taskapp.group_kind(v_group_id) <> 'management' then
    raise exception '只有管理组的任务有 RACI' using errcode = 'check_violation';
  end if;
  if not taskapp.can_manage_group_tasks(v_group_id) then
    raise exception '只有组长和管理员可以设定 RACI' using errcode = 'insufficient_privilege';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) loop
    if v_item ->> 'user_id' is not null and not exists (
      select 1 from taskapp.group_members
      where group_id = v_group_id and user_id = (v_item ->> 'user_id')::uuid
    ) then
      raise exception 'RACI 里的成员必须是组内成员' using errcode = 'check_violation';
    end if;
    if v_item ->> 'contact_id' is not null and not exists (
      select 1 from taskapp.group_contacts
      where group_id = v_group_id and id = (v_item ->> 'contact_id')::uuid
    ) then
      raise exception '只有名字的人不在这个组里' using errcode = 'check_violation';
    end if;
  end loop;

  -- 每个字母之前和之后的人（排好序，便于比较）
  select coalesce(jsonb_object_agg(role, people), '{}') into v_before from (
    select role, jsonb_agg(coalesce(user_id, contact_id) order by coalesce(user_id, contact_id)) people
    from taskapp.task_assignments where task_id = p_task_id group by role
  ) x;

  delete from taskapp.task_assignments where task_id = p_task_id;
  insert into taskapp.task_assignments (task_id, role, user_id, contact_id)
  select distinct p_task_id, x ->> 'role', (x ->> 'user_id')::uuid, (x ->> 'contact_id')::uuid
  from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) x;

  select coalesce(jsonb_object_agg(role, people), '{}') into v_after from (
    select role, jsonb_agg(coalesce(user_id, contact_id) order by coalesce(user_id, contact_id)) people
    from taskapp.task_assignments where task_id = p_task_id group by role
  ) x;

  -- 新设的执行人
  for v_user in
    select a.user_id from taskapp.task_assignments a
    where a.task_id = p_task_id and a.role = 'R'
      and not coalesce(v_before -> 'R', '[]'::jsonb) @> to_jsonb(a.user_id::text)
  loop
    perform taskapp.notify_task_v2(v_user, 'assigned', p_task_id, v_user);
    perform taskapp.notify_task_roles(p_task_id, array['I'], 'assigned', v_user);
  end loop;

  if p_is_new then
    return;
  end if;
  foreach v_role in array array['R', 'A', 'C', 'I'] loop
    if coalesce(v_before -> v_role, '[]'::jsonb) is distinct from coalesce(v_after -> v_role, '[]'::jsonb)
       -- 执行人只是多了人：已经发了"设为执行人"，不再算修改
       and not (v_role = 'R' and coalesce(v_after -> 'R', '[]'::jsonb) @> coalesce(v_before -> 'R', '[]'::jsonb)) then
      v_fields := v_fields || v_role;
    end if;
  end loop;
  if cardinality(v_fields) > 0 then
    perform taskapp.notify_task_roles(p_task_id, array['R', 'I'], 'modified', null, v_fields);
  end if;
end;
$$;

create or replace function taskapp.set_task_raci(p_task_id uuid, p_assignments jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select taskapp.apply_task_raci(p_task_id, p_assignments, false);
$$;

-- 管理组的任务（未删除）在事务提交时必须至少有一个执行人和一个负责人
create function taskapp.check_task_has_ra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
begin
  if tg_table_name = 'tasks' then
    v_task_id := new.id;
  else
    -- 去掉的是顾问或知会时不用检查（以前建的、还没有执行人和负责人的任务不受影响）
    if old.role not in ('R', 'A') then
      return null;
    end if;
    v_task_id := old.task_id;
  end if;
  if exists (
    select 1 from taskapp.tasks t join taskapp.groups g on g.id = t.group_id
    where t.id = v_task_id and g.kind = 'management' and t.deleted_at is null
  ) and (
    not exists (select 1 from taskapp.task_assignments where task_id = v_task_id and role = 'R')
    or not exists (select 1 from taskapp.task_assignments where task_id = v_task_id and role = 'A')
  ) then
    raise exception '管理组的任务必须有执行人和负责人' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger tasks_require_ra
  after insert on taskapp.tasks
  deferrable initially deferred
  for each row execute function taskapp.check_task_has_ra();

create constraint trigger task_assignments_require_ra
  after update or delete on taskapp.task_assignments
  deferrable initially deferred
  for each row execute function taskapp.check_task_has_ra();

-- 管理组建任务：任务、RACI、地点、人物在同一个事务里一起写入
create function taskapp.create_task_with_raci(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_deadline_at timestamptz,
  p_recurrence_rule text,
  p_recurrence_dtstart timestamptz,
  p_assignments jsonb,
  p_location jsonb default null,
  p_people jsonb default '[]'
)
returns taskapp.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task taskapp.tasks;
begin
  if not taskapp.can_manage_group_tasks(p_group_id) then
    raise exception '没有建任务的权限' using errcode = 'insufficient_privilege';
  end if;
  insert into taskapp.tasks
    (owner_id, group_id, title, description, deadline_at, recurrence_rule, recurrence_dtstart)
  values
    (auth.uid(), p_group_id, btrim(p_title), coalesce(p_description, ''), p_deadline_at,
     p_recurrence_rule, p_recurrence_dtstart)
  returning * into v_task;
  perform set_config('taskapp.creating_task', v_task.id::text, true);
  perform taskapp.apply_task_raci(v_task.id, p_assignments, true);
  if p_location is not null then
    insert into taskapp.task_locations (task_id, name, address)
    values (v_task.id, coalesce(p_location ->> 'name', ''), coalesce(p_location ->> 'address', ''));
  end if;
  insert into taskapp.task_people (task_id, name, relation)
  select v_task.id, p ->> 'name', coalesce(p ->> 'relation', '')
  from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) p;
  perform set_config('taskapp.creating_task', '', true);
  return v_task;
end;
$$;

-- 4. 通知的读取 --------------------------------------------------------------------------------

drop function taskapp.my_notifications();
create function taskapp.my_notifications()
returns table (
  kind text,
  id uuid,
  group_id uuid,
  group_name text,
  actor_name text,
  created_at timestamptz,
  task_id uuid,
  task_title text,
  subject_name text,
  action text,
  fields text[],
  subject_is_me boolean,
  can_confirm boolean,
  task_deleted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  -- 入组邀请
  select 'group_invitation', i.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), i.created_at,
         null::uuid, null::text, null::text, null::text, null::text[], null::boolean,
         false, false
  from taskapp.group_invitations i
  join taskapp.groups g on g.id = i.group_id
  join taskapp.users u on u.id = i.invited_by
  left join taskapp.group_members m on m.group_id = i.group_id and m.user_id = i.invited_by
  where auth.uid() is not null
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  union all
  -- 删除组的投票（我是组长、还没投）
  select 'group_deletion_vote', r.group_id, g.id, g.name,
         coalesce(m.nickname, u.display_name), r.started_at,
         null, null, null, null, null, null, false, false
  from taskapp.group_deletion_requests r
  join taskapp.groups g on g.id = r.group_id
  join taskapp.users u on u.id = r.initiated_by
  left join taskapp.group_members m on m.group_id = r.group_id and m.user_id = r.initiated_by
  where taskapp.my_group_role(r.group_id) = 'leader'
    and not exists (
      select 1 from taskapp.group_deletion_votes v
      where v.group_id = r.group_id and v.user_id = auth.uid()
    )
  union all
  -- 任命组长的投票（我是组长、还没投）
  select 'group_leader_vote', r.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), r.started_at,
         null, null, coalesce(cm.nickname, cu.display_name), null, null, false, false, false
  from taskapp.group_leader_requests r
  join taskapp.groups g on g.id = r.group_id
  join taskapp.users u on u.id = r.initiated_by
  left join taskapp.group_members m on m.group_id = r.group_id and m.user_id = r.initiated_by
  join taskapp.users cu on cu.id = r.candidate_id
  left join taskapp.group_members cm on cm.group_id = r.group_id and cm.user_id = r.candidate_id
  where taskapp.my_group_role(r.group_id) = 'leader'
    and not exists (
      select 1 from taskapp.group_leader_votes v
      where v.request_id = r.id and v.user_id = auth.uid()
    )
  union all
  -- 任务通知：我还在这个组里；任务被删除时只显示"删除"这条；
  -- 负责人收到的"完成"只在任务还待确认时显示（确认或退回后就不用再处理）
  select 'task', n.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), n.created_at,
         t.id, t.title,
         coalesce(tm.nickname, tu.display_name), n.action, n.fields,
         n.target_user_id = auth.uid(),
         n.action = 'completed' and taskapp.has_task_role(t.id, 'A')
           and t.completed_at is not null and t.confirmed_at is null and t.deleted_at is null,
         t.deleted_at is not null
  from taskapp.task_notifications n
  join taskapp.tasks t on t.id = n.task_id
  join taskapp.groups g on g.id = t.group_id
  left join taskapp.users u on u.id = n.actor_id
  left join taskapp.group_members m on m.group_id = g.id and m.user_id = n.actor_id
  left join taskapp.users tu on tu.id = n.target_user_id
  left join taskapp.group_members tm on tm.group_id = g.id and tm.user_id = n.target_user_id
  where n.user_id = auth.uid()
    and n.dismissed_at is null
    and taskapp.is_group_member(g.id)
    and (t.deleted_at is null or 'deleted' = any (n.fields))
    and not (
      n.action = 'completed' and taskapp.has_task_role(t.id, 'A')
      and not (t.completed_at is not null and t.confirmed_at is null)
    )
  order by 6 desc;
$$;

-- 旧的通知函数已被取代
drop function taskapp.notify_task(uuid, text, uuid);

-- 内部函数不对外开放
revoke execute on function
  taskapp.notify_task_v2(uuid, text, uuid, uuid, text[]),
  taskapp.notify_task_roles(uuid, text[], text, uuid, text[]),
  taskapp.apply_task_raci(uuid, jsonb, boolean)
from public, anon, authenticated;

grant execute on function
  taskapp.notification_field_order(),
  taskapp.is_creating_task(uuid),
  taskapp.create_task_with_raci(uuid, text, text, timestamptz, text, timestamptz, jsonb, jsonb, jsonb),
  taskapp.set_task_raci(uuid, jsonb),
  taskapp.my_notifications()
to authenticated;

-- ==== 20261004000012_projects_and_toolbox.sql ====

-- 组里的项目、工具箱。
--
-- 结构：组是项目的容器；组里的任务必须属于一个（且只属于一个）项目。项目有名字、颜色、工具箱。
-- 组的类型（合作组 / 管理组）只决定身份结构：合作组人人都是组长；管理组分组长和成员。
-- 管理员是项目层级的身份，只在被任命的项目里有效。
--
-- 工具箱（建项目时选，可以多选或都不选，建好后不能改）：
--   assignment（任务分配）：RACI、建任务必须有执行人和负责人、待确认、任务通知、责任分配矩阵、
--                         只有执行人能标记完成、负责人确认或退回、只有名字的人
--   relations（任务关系）：这一轮只记录选择，没有功能
-- 个人分类也有工具箱，只有 relations。
--
-- 身份：
--   组长：自动在每个项目里（不在 project_members 里存行），在项目里等同于管理员，不能被移出项目。
--         只有组长能建项目、改项目名和颜色、任命 / 撤销项目管理员、邀请人进小组、踢出小组、
--         任命新组长（投票）、删除组和删除项目（投票）。
--   管理员（项目）：在这个项目里建、改、删任务，设 RACI，往项目里加人、移出成员，添加和删除只有名字的人。
--   成员：开了任务分配时按 RACI；没开时只能标记完成。
--   合作组里人人都是组长；只加入了项目、不在小组里的人，在合作组的项目里也是管理员。
-- 项目里的任务只有这个项目的成员能看到。

-- 1. 清空全部数据（都是测试数据；Alethego 的账号不受影响，用户下次登录时 users 自动重建） ---------

do $$
begin
  execute (
    select 'truncate table ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' cascade'
    from pg_tables where schemaname = 'taskapp'
  );
end;
$$;

-- 2. 组的身份：组长 / 成员（管理员改到项目上） ------------------------------------------------

alter table taskapp.group_members drop constraint group_members_role_check;
alter table taskapp.group_members
  add constraint group_members_role_check check (role in ('leader', 'member'));

drop function taskapp.set_group_member_role(uuid, uuid, text);
drop function taskapp.create_group(text);

create function taskapp.is_group_leader(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(taskapp.my_group_role(p_group_id) = 'leader', false);
$$;

-- 3. 项目 --------------------------------------------------------------------------------------

create table taskapp.projects (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references taskapp.groups (id) on delete cascade,
  name       text not null
             constraint projects_name_not_blank check (btrim(name) <> ''),
  color      text
             constraint projects_color_format check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  tools      text[] not null default '{}'
             constraint projects_tools_check check (tools <@ array['assignment', 'relations']),
  created_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_group_id_idx on taskapp.projects (group_id);

create trigger projects_set_updated_at
  before update on taskapp.projects
  for each row execute function taskapp.set_updated_at();

-- 工具箱建好后不能改；项目不能换组
create function taskapp.projects_immutable_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tools is distinct from old.tools then
    raise exception '项目的工具箱建好后不能改' using errcode = 'check_violation';
  end if;
  if new.group_id is distinct from old.group_id then
    raise exception '项目不能换到别的组' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger projects_immutable_fields
  before update on taskapp.projects
  for each row execute function taskapp.projects_immutable_fields();

-- 项目成员（组长不在这里：组长自动在每个项目里）
create table taskapp.project_members (
  project_id uuid not null references taskapp.projects (id) on delete cascade,
  user_id    uuid not null references taskapp.users (id),
  role       text not null default 'member'
             constraint project_members_role_check check (role in ('admin', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_id_idx on taskapp.project_members (user_id);

-- 邀请不在小组里的人加入项目（对方在通知里同意后加入）
create table taskapp.project_invitations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references taskapp.projects (id) on delete cascade,
  email      text not null
             constraint project_invitations_email_normalized check (email = lower(btrim(email)) and email <> ''),
  invited_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default taskapp.clock_now(),
  unique (project_id, email)
);

-- 删除项目的投票：规则同删除组（全体组长投票，发起者算同意，一个不同意就取消，一周不操作算同意）
create table taskapp.project_deletion_requests (
  project_id   uuid primary key references taskapp.projects (id) on delete cascade,
  initiated_by uuid not null references taskapp.users (id),
  started_at   timestamptz not null default taskapp.clock_now()
);

create table taskapp.project_deletion_votes (
  project_id uuid not null references taskapp.project_deletion_requests (project_id) on delete cascade,
  user_id    uuid not null references taskapp.users (id),
  voted_at   timestamptz not null default taskapp.clock_now(),
  primary key (project_id, user_id)
);

-- 只有名字的人改到项目上（开了任务分配的项目）
drop function taskapp.remove_group_contact(uuid);
drop table taskapp.group_contacts cascade;

create table taskapp.project_contacts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references taskapp.projects (id) on delete cascade,
  name       text not null
             constraint project_contacts_name_not_blank check (btrim(name) <> ''),
  created_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default now()
);

create index project_contacts_project_id_idx on taskapp.project_contacts (project_id);

alter table taskapp.task_assignments
  add constraint task_assignments_contact_id_fkey
  foreign key (contact_id) references taskapp.project_contacts (id) on delete cascade;

-- 个人分类的工具箱：只有任务关系；建好后不能改
alter table taskapp.categories
  add column tools text[] not null default '{}'
  constraint categories_tools_check check (tools <@ array['relations']);

create function taskapp.categories_tools_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tools is distinct from old.tools then
    raise exception '分类的工具箱建好后不能改' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger categories_tools_immutable
  before update on taskapp.categories
  for each row execute function taskapp.categories_tools_immutable();

-- 4. 任务属于项目 ------------------------------------------------------------------------------

alter table taskapp.tasks
  add column project_id uuid references taskapp.projects (id) on delete cascade;
alter table taskapp.tasks
  add constraint tasks_project_container check ((group_id is null) = (project_id is null));

create index tasks_project_id_idx on taskapp.tasks (project_id) where project_id is not null;

-- 组任务的 group_id 跟着项目走（写入时按项目填好）
create function taskapp.tasks_group_from_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is not null then
    select group_id into new.group_id from taskapp.projects where id = new.project_id;
  end if;
  return new;
end;
$$;

create trigger tasks_group_from_project
  before insert on taskapp.tasks
  for each row execute function taskapp.tasks_group_from_project();

-- 任务不能在个人、组、项目之间移动
create or replace function taskapp.tasks_container_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id or new.project_id is distinct from old.project_id then
    raise exception '任务不能在个人和项目之间、项目和项目之间移动' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 5. 身份判断 ----------------------------------------------------------------------------------

create function taskapp.project_group(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select group_id from taskapp.projects where id = p_project_id;
$$;

create function taskapp.project_has_tool(p_project_id uuid, p_tool text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p_tool = any (tools) from taskapp.projects where id = p_project_id), false);
$$;

-- 某人是不是这个项目的成员（组长自动是）
create function taskapp.is_project_member_user(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.projects p
    join taskapp.group_members m on m.group_id = p.group_id and m.user_id = p_user_id
    where p.id = p_project_id and m.role = 'leader'
  ) or exists (
    select 1 from taskapp.project_members
    where project_id = p_project_id and user_id = p_user_id
  );
$$;

create function taskapp.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select taskapp.is_project_member_user(p_project_id, auth.uid());
$$;

-- 项目管理员：组长；被任命的管理员；合作组的项目里人人都是管理员
create function taskapp.is_project_admin(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select taskapp.is_group_leader(taskapp.project_group(p_project_id))
    or exists (
      select 1 from taskapp.project_members pm
      where pm.project_id = p_project_id and pm.user_id = auth.uid()
        and (pm.role = 'admin' or taskapp.group_kind(taskapp.project_group(p_project_id)) = 'cooperative')
    );
$$;

-- 能看到这个组（组名）：小组成员，或者只加入了组里某个项目的人
create function taskapp.is_group_participant(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select taskapp.is_group_member(p_group_id) or exists (
    select 1 from taskapp.project_members pm join taskapp.projects p on p.id = pm.project_id
    where p.group_id = p_group_id and pm.user_id = auth.uid()
  );
$$;

create or replace function taskapp.can_access_task(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t
    where t.id = p_task_id
      and (
        (t.group_id is null and t.owner_id = (select taskapp.current_owner_id()))
        or (t.project_id is not null and taskapp.is_project_member(t.project_id))
      )
  );
$$;

create or replace function taskapp.can_edit_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t
    where t.id = p_task_id
      and (
        (t.group_id is null and t.owner_id = auth.uid())
        or (t.project_id is not null and taskapp.is_project_admin(t.project_id))
      )
  );
$$;

-- 6. RLS --------------------------------------------------------------------------------------

drop policy "tasks_select" on taskapp.tasks;
drop policy "tasks_insert" on taskapp.tasks;
drop policy "tasks_update" on taskapp.tasks;

create policy "tasks_select" on taskapp.tasks
  for select to authenticated
  using (
    (group_id is null and owner_id = (select taskapp.current_owner_id()))
    or (project_id is not null and taskapp.is_project_member(project_id))
  );

create policy "tasks_insert" on taskapp.tasks
  for insert to authenticated
  with check (
    owner_id = (select taskapp.current_owner_id())
    and (project_id is null or taskapp.is_project_admin(project_id))
  );

create policy "tasks_update" on taskapp.tasks
  for update to authenticated
  using (
    (group_id is null and owner_id = (select taskapp.current_owner_id()))
    or (project_id is not null and taskapp.is_project_member(project_id))
  )
  with check (
    (group_id is null and owner_id = (select taskapp.current_owner_id()))
    or (project_id is not null and taskapp.is_project_member(project_id))
  );

drop function taskapp.can_manage_group_tasks(uuid);

drop policy "groups_select_member" on taskapp.groups;
create policy "groups_select_participant" on taskapp.groups
  for select to authenticated using (taskapp.is_group_participant(id));

alter table taskapp.projects enable row level security;
alter table taskapp.project_members enable row level security;
alter table taskapp.project_invitations enable row level security;
alter table taskapp.project_deletion_requests enable row level security;
alter table taskapp.project_deletion_votes enable row level security;
alter table taskapp.project_contacts enable row level security;

create policy "projects_select_member" on taskapp.projects
  for select to authenticated using (taskapp.is_project_member(id));
create policy "project_members_select_member" on taskapp.project_members
  for select to authenticated using (taskapp.is_project_member(project_id));
create policy "project_invitations_select" on taskapp.project_invitations
  for select to authenticated
  using (
    taskapp.is_project_admin(project_id)
    or email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
create policy "project_deletion_requests_select_member" on taskapp.project_deletion_requests
  for select to authenticated using (taskapp.is_project_member(project_id));
create policy "project_deletion_votes_select_member" on taskapp.project_deletion_votes
  for select to authenticated using (taskapp.is_project_member(project_id));
create policy "project_contacts_select_member" on taskapp.project_contacts
  for select to authenticated using (taskapp.is_project_member(project_id));

revoke insert, update, delete on taskapp.projects, taskapp.project_members,
  taskapp.project_invitations, taskapp.project_deletion_requests, taskapp.project_deletion_votes,
  taskapp.project_contacts
  from anon, authenticated;
grant select on taskapp.projects, taskapp.project_members, taskapp.project_invitations,
  taskapp.project_deletion_requests, taskapp.project_deletion_votes, taskapp.project_contacts
  to authenticated;

-- 7. 任务规则按项目的工具箱 --------------------------------------------------------------------

-- 写入规则：
--   个人任务：完成即确认
--   项目：内容（标题、描述、时间、循环、删除）只有项目管理员能改；
--     没开任务分配：项目成员都能标记完成，完成即确认
--     开了任务分配：只有执行人能标记完成（执行人同时是负责人，或任务没有负责人时直接算已完成，
--       否则待确认）；负责人确认；执行人或负责人能取消完成（负责人在待确认时取消 = 退回）
create or replace function taskapp.tasks_completion_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assign boolean;
  v_is_r boolean;
  v_is_a boolean;
  v_has_a boolean;
begin
  if new.project_id is null then
    new.confirmed_at := new.completed_at;
    return new;
  end if;
  v_assign := taskapp.project_has_tool(new.project_id, 'assignment');

  if tg_op = 'INSERT' then
    if v_assign then
      -- 新任务还没有 RACI，不能直接带着完成状态
      new.completed_at := null;
      new.confirmed_at := null;
    else
      new.confirmed_at := new.completed_at;
    end if;
    return new;
  end if;

  -- 没有登录身份（控制台里的维护操作）不做身份检查
  if auth.uid() is null then
    if not v_assign then
      new.confirmed_at := new.completed_at;
    end if;
    return new;
  end if;

  if (new.title, new.description, new.deadline_at, new.recurrence_rule, new.recurrence_dtstart,
      new.deleted_at, new.owner_id)
     is distinct from
     (old.title, old.description, old.deadline_at, old.recurrence_rule, old.recurrence_dtstart,
      old.deleted_at, old.owner_id)
     and not taskapp.is_project_admin(new.project_id) then
    raise exception '只有项目管理员可以编辑任务' using errcode = 'insufficient_privilege';
  end if;

  if not v_assign then
    new.confirmed_at := new.completed_at;
    return new;
  end if;

  v_is_r := taskapp.has_task_role(new.id, 'R');
  v_is_a := taskapp.has_task_role(new.id, 'A');
  v_has_a := exists (select 1 from taskapp.task_assignments where task_id = new.id and role = 'A');

  if old.completed_at is null and new.completed_at is not null then
    if not v_is_r then
      raise exception '只有执行人可以标记完成' using errcode = 'insufficient_privilege';
    end if;
    new.confirmed_at := case when v_is_a or not v_has_a then new.completed_at end;
  elsif old.completed_at is not null and new.completed_at is null then
    if not (v_is_r or v_is_a) then
      raise exception '只有执行人或负责人可以取消完成' using errcode = 'insufficient_privilege';
    end if;
    new.confirmed_at := null;
  elsif new.confirmed_at is distinct from old.confirmed_at then
    if not v_is_a or new.completed_at is null or new.confirmed_at is null then
      raise exception '只有负责人可以确认完成' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

-- 循环任务：开了任务分配的项目里只有执行人能完成（或取消完成）某一次
create or replace function taskapp.occurrence_completion_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null then
    return new;
  end if;
  select project_id into v_project_id from taskapp.tasks where id = new.task_id;
  if (new.status = 'completed') is distinct from
     (tg_op = 'UPDATE' and old.status = 'completed')
     and v_project_id is not null
     and taskapp.project_has_tool(v_project_id, 'assignment')
     and not taskapp.has_task_role(new.task_id, 'R') then
    raise exception '只有执行人可以完成这一次' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- 任务通知只发给这个项目的成员
create or replace function taskapp.notify_task_v2(
  p_user_id uuid,
  p_action text,
  p_task_id uuid,
  p_target uuid default null,
  p_fields text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  if p_user_id is null or p_user_id = auth.uid() then
    return;
  end if;
  select project_id into v_project_id from taskapp.tasks where id = p_task_id;
  if v_project_id is null or not taskapp.is_project_member_user(v_project_id, p_user_id) then
    return;
  end if;
  update taskapp.task_notifications n
  set created_at = taskapp.clock_now(),
      actor_id = auth.uid(),
      fields = (
        select coalesce(array_agg(f order by array_position(taskapp.notification_field_order(), f)), '{}')
        from (select distinct unnest(n.fields || p_fields) as f) merged
      )
  where n.user_id = p_user_id and n.task_id = p_task_id and n.action = p_action
    and n.target_user_id is not distinct from p_target
    and n.dismissed_at is null;
  if found then
    return;
  end if;
  insert into taskapp.task_notifications (user_id, action, task_id, actor_id, target_user_id, fields)
  values (p_user_id, p_action, p_task_id, auth.uid(), p_target, coalesce(p_fields, '{}'));
end;
$$;

-- 任务通知只在开了任务分配的项目里发
create or replace function taskapp.tasks_notify_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[];
begin
  if new.project_id is null or not taskapp.project_has_tool(new.project_id, 'assignment') then
    return null;
  end if;

  if old.completed_at is null and new.completed_at is not null then
    perform taskapp.notify_task_roles(new.id, array['A', 'I'], 'completed');
  elsif old.confirmed_at is null and new.confirmed_at is not null and old.completed_at is not null then
    perform taskapp.notify_task_roles(new.id, array['R', 'I'], 'confirmed');
  elsif old.completed_at is not null and old.confirmed_at is null and new.completed_at is null
        and taskapp.has_task_role(new.id, 'A') and not taskapp.has_task_role(new.id, 'R') then
    perform taskapp.notify_task_roles(new.id, array['R', 'I'], 'rejected');
  end if;

  v_fields := array_remove(array[
    case when new.title is distinct from old.title then 'title' end,
    case when new.description is distinct from old.description then 'description' end,
    case when new.deadline_at is distinct from old.deadline_at then 'deadline' end,
    case when (new.recurrence_rule, new.recurrence_dtstart)
              is distinct from (old.recurrence_rule, old.recurrence_dtstart) then 'recurrence' end,
    case when old.deleted_at is null and new.deleted_at is not null then 'deleted'
         when old.deleted_at is not null and new.deleted_at is null then 'restored' end
  ], null);
  if cardinality(v_fields) > 0 then
    perform taskapp.notify_task_roles(new.id, array['R', 'I'], 'modified', null, v_fields);
  end if;
  return null;
end;
$$;

create or replace function taskapp.task_extension_notify_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid := coalesce(new.task_id, old.task_id);
  v_project_id uuid;
begin
  select project_id into v_project_id from taskapp.tasks where id = v_task_id;
  if taskapp.is_creating_task(v_task_id) or v_project_id is null
     or not taskapp.project_has_tool(v_project_id, 'assignment') then
    return null;
  end if;
  perform taskapp.notify_task_roles(
    v_task_id,
    array['R', 'I'],
    'modified',
    null,
    array[case when tg_table_name = 'task_people' then 'people' else 'location' end]
  );
  return null;
end;
$$;

-- 开了任务分配的项目：未删除的任务必须有执行人和负责人
create or replace function taskapp.check_task_has_ra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
begin
  if tg_table_name = 'tasks' then
    v_task_id := new.id;
  else
    if old.role not in ('R', 'A') then
      return null;
    end if;
    v_task_id := old.task_id;
  end if;
  if exists (
    select 1 from taskapp.tasks t
    where t.id = v_task_id and t.deleted_at is null and t.project_id is not null
      and taskapp.project_has_tool(t.project_id, 'assignment')
  ) and (
    not exists (select 1 from taskapp.task_assignments where task_id = v_task_id and role = 'R')
    or not exists (select 1 from taskapp.task_assignments where task_id = v_task_id and role = 'A')
  ) then
    raise exception '开了任务分配的项目，任务必须有执行人和负责人' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

-- 设 RACI：开了任务分配的项目的管理员；R、A、C、I 里的成员必须是项目成员，只有名字的人必须是这个项目的
create or replace function taskapp.apply_task_raci(p_task_id uuid, p_assignments jsonb, p_is_new boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_item jsonb;
  v_before jsonb;
  v_after jsonb;
  v_role text;
  v_fields text[] := '{}';
  v_user uuid;
begin
  select project_id into v_project_id from taskapp.tasks where id = p_task_id;
  if v_project_id is null or not taskapp.project_has_tool(v_project_id, 'assignment') then
    raise exception '只有开了任务分配的项目有 RACI' using errcode = 'check_violation';
  end if;
  if not taskapp.is_project_admin(v_project_id) then
    raise exception '只有项目管理员可以设定 RACI' using errcode = 'insufficient_privilege';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) loop
    if v_item ->> 'user_id' is not null
       and not taskapp.is_project_member_user(v_project_id, (v_item ->> 'user_id')::uuid) then
      raise exception 'RACI 里的成员必须是项目成员' using errcode = 'check_violation';
    end if;
    if v_item ->> 'contact_id' is not null and not exists (
      select 1 from taskapp.project_contacts
      where project_id = v_project_id and id = (v_item ->> 'contact_id')::uuid
    ) then
      raise exception '只有名字的人不在这个项目里' using errcode = 'check_violation';
    end if;
  end loop;

  select coalesce(jsonb_object_agg(role, people), '{}') into v_before from (
    select role, jsonb_agg(coalesce(user_id, contact_id) order by coalesce(user_id, contact_id)) people
    from taskapp.task_assignments where task_id = p_task_id group by role
  ) x;

  delete from taskapp.task_assignments where task_id = p_task_id;
  insert into taskapp.task_assignments (task_id, role, user_id, contact_id)
  select distinct p_task_id, x ->> 'role', (x ->> 'user_id')::uuid, (x ->> 'contact_id')::uuid
  from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) x;

  select coalesce(jsonb_object_agg(role, people), '{}') into v_after from (
    select role, jsonb_agg(coalesce(user_id, contact_id) order by coalesce(user_id, contact_id)) people
    from taskapp.task_assignments where task_id = p_task_id group by role
  ) x;

  for v_user in
    select a.user_id from taskapp.task_assignments a
    where a.task_id = p_task_id and a.role = 'R'
      and not coalesce(v_before -> 'R', '[]'::jsonb) @> to_jsonb(a.user_id::text)
  loop
    perform taskapp.notify_task_v2(v_user, 'assigned', p_task_id, v_user);
    perform taskapp.notify_task_roles(p_task_id, array['I'], 'assigned', v_user);
  end loop;

  if p_is_new then
    return;
  end if;
  foreach v_role in array array['R', 'A', 'C', 'I'] loop
    if coalesce(v_before -> v_role, '[]'::jsonb) is distinct from coalesce(v_after -> v_role, '[]'::jsonb)
       and not (v_role = 'R' and coalesce(v_after -> 'R', '[]'::jsonb) @> coalesce(v_before -> 'R', '[]'::jsonb)) then
      v_fields := v_fields || v_role;
    end if;
  end loop;
  if cardinality(v_fields) > 0 then
    perform taskapp.notify_task_roles(p_task_id, array['R', 'I'], 'modified', null, v_fields);
  end if;
end;
$$;

-- 开了任务分配的项目里建任务：任务、RACI、地点、人物在同一个事务里一起写入
drop function taskapp.create_task_with_raci(uuid, text, text, timestamptz, text, timestamptz, jsonb, jsonb, jsonb);
create function taskapp.create_task_with_raci(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_deadline_at timestamptz,
  p_recurrence_rule text,
  p_recurrence_dtstart timestamptz,
  p_assignments jsonb,
  p_location jsonb default null,
  p_people jsonb default '[]'
)
returns taskapp.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task taskapp.tasks;
begin
  if not taskapp.is_project_admin(p_project_id) then
    raise exception '只有项目管理员可以建任务' using errcode = 'insufficient_privilege';
  end if;
  insert into taskapp.tasks
    (owner_id, project_id, title, description, deadline_at, recurrence_rule, recurrence_dtstart)
  values
    (auth.uid(), p_project_id, btrim(p_title), coalesce(p_description, ''), p_deadline_at,
     p_recurrence_rule, p_recurrence_dtstart)
  returning * into v_task;
  perform set_config('taskapp.creating_task', v_task.id::text, true);
  perform taskapp.apply_task_raci(v_task.id, p_assignments, true);
  if p_location is not null then
    insert into taskapp.task_locations (task_id, name, address)
    values (v_task.id, coalesce(p_location ->> 'name', ''), coalesce(p_location ->> 'address', ''));
  end if;
  insert into taskapp.task_people (task_id, name, relation)
  select v_task.id, p ->> 'name', coalesce(p ->> 'relation', '')
  from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) p;
  perform set_config('taskapp.creating_task', '', true);
  return v_task;
end;
$$;

-- 8. 小组：邀请、踢出、退出 ---------------------------------------------------------------------

-- 只有组长能邀请人进小组。被邀请的人：合作组里是组长，管理组里是成员
create or replace function taskapp.invite_to_group(p_group_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if not taskapp.is_group_leader(p_group_id) then
    raise exception '只有组长可以邀请人进小组' using errcode = 'insufficient_privilege';
  end if;
  if v_email = '' then
    raise exception '邮箱不能为空' using errcode = 'check_violation';
  end if;
  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    return 'self';
  end if;
  if exists (
    select 1 from taskapp.group_members m join taskapp.users u on u.id = m.user_id
    where m.group_id = p_group_id and lower(u.email) = v_email
  ) then
    return 'already_member';
  end if;
  insert into taskapp.group_invitations (group_id, email, invited_by)
  values (p_group_id, v_email, auth.uid())
  on conflict (group_id, email) do nothing;
  return case when found then 'invited' else 'already_invited' end;
end;
$$;

create or replace function taskapp.accept_group_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id
  from taskapp.group_invitations
  where id = p_invitation_id and email = lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_group_id is null then
    raise exception '邀请不存在' using errcode = 'no_data_found';
  end if;
  insert into taskapp.group_members (group_id, user_id, role)
  values (
    v_group_id,
    auth.uid(),
    case taskapp.group_kind(v_group_id) when 'cooperative' then 'leader' else 'member' end
  )
  on conflict (group_id, user_id) do nothing;
  -- 成了组长（合作组）：以前只加入了项目的行不再需要（组长自动在每个项目里）
  if taskapp.group_kind(v_group_id) = 'cooperative' then
    delete from taskapp.project_members pm using taskapp.projects p
    where p.id = pm.project_id and p.group_id = v_group_id and pm.user_id = auth.uid();
  end if;
  delete from taskapp.group_invitations where id = p_invitation_id;
  return v_group_id;
end;
$$;

-- 某人在本组所有项目（未删除的任务）上的 R、A、C、I，带项目名
drop function taskapp.member_task_roles(uuid, uuid);
create function taskapp.member_task_roles(p_group_id uuid, p_user_id uuid)
returns table (task_id uuid, task_title text, role text, project_id uuid, project_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, a.role, p.id, p.name
  from taskapp.task_assignments a
  join taskapp.tasks t on t.id = a.task_id
  join taskapp.projects p on p.id = t.project_id
  where taskapp.is_group_participant(p_group_id)
    and t.group_id = p_group_id and t.deleted_at is null and a.user_id = p_user_id
  order by p.name, t.title, t.id, position(a.role in 'RACI');
$$;

-- 某人在一个项目（未删除的任务）上的 R、A、C、I
create function taskapp.project_member_task_roles(p_project_id uuid, p_user_id uuid)
returns table (task_id uuid, task_title text, role text, project_id uuid, project_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, a.role, p.id, p.name
  from taskapp.task_assignments a
  join taskapp.tasks t on t.id = a.task_id
  join taskapp.projects p on p.id = t.project_id
  where taskapp.is_project_member(p_project_id)
    and t.project_id = p_project_id and t.deleted_at is null and a.user_id = p_user_id
  order by t.title, t.id, position(a.role in 'RACI');
$$;

create function taskapp.has_ra_in_project(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.task_assignments a
    join taskapp.tasks t on t.id = a.task_id
    where t.project_id = p_project_id and t.deleted_at is null
      and a.user_id = p_user_id and a.role in ('R', 'A')
  );
$$;

-- 内部：把某人移出项目（他在这个项目里的 RACI 一并去掉）
create function taskapp.remove_project_member_now(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from taskapp.task_assignments a
  using taskapp.tasks t
  where t.id = a.task_id and t.project_id = p_project_id and a.user_id = p_user_id;
  delete from taskapp.project_members where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- 内部：删除项目（连同项目里的全部任务）
create function taskapp.delete_project_now(p_project_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from taskapp.projects where id = p_project_id;
$$;

-- 内部：全体组长都同意了就删除项目
create function taskapp.finish_project_deletion_if_agreed(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := taskapp.project_group(p_project_id);
begin
  if exists (select 1 from taskapp.project_deletion_requests where project_id = p_project_id)
     and not exists (
       select 1 from taskapp.group_members m
       where m.group_id = v_group_id and m.role = 'leader'
         and not exists (
           select 1 from taskapp.project_deletion_votes v
           where v.project_id = p_project_id and v.user_id = m.user_id
         )
     ) then
    perform taskapp.delete_project_now(p_project_id);
    return true;
  end if;
  return false;
end;
$$;

-- 内部：把某人移出小组（同时移出组里的全部项目，RACI 一并去掉；他的投票作废），
-- 然后看剩下的组长是不是都同意了正在进行的投票
create or replace function taskapp.remove_member_now(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  delete from taskapp.task_assignments a
  using taskapp.tasks t
  where t.id = a.task_id and t.group_id = p_group_id and a.user_id = p_user_id;
  delete from taskapp.project_members pm using taskapp.projects p
  where p.id = pm.project_id and p.group_id = p_group_id and pm.user_id = p_user_id;
  delete from taskapp.group_leader_requests
  where group_id = p_group_id and candidate_id = p_user_id;
  delete from taskapp.group_leader_votes v
  using taskapp.group_leader_requests r
  where r.id = v.request_id and r.group_id = p_group_id and v.user_id = p_user_id;
  delete from taskapp.group_deletion_votes where group_id = p_group_id and user_id = p_user_id;
  delete from taskapp.project_deletion_votes v using taskapp.projects p
  where p.id = v.project_id and p.group_id = p_group_id and v.user_id = p_user_id;
  delete from taskapp.group_members where group_id = p_group_id and user_id = p_user_id;

  if not exists (select 1 from taskapp.group_members where group_id = p_group_id) then
    perform taskapp.delete_group_now(p_group_id);
    return;
  end if;
  if taskapp.finish_group_deletion_if_agreed(p_group_id) then
    return;
  end if;
  for v_id in select id from taskapp.group_leader_requests where group_id = p_group_id loop
    perform taskapp.finish_leader_request_if_agreed(v_id);
  end loop;
  for v_id in
    select r.project_id from taskapp.project_deletion_requests r
    join taskapp.projects p on p.id = r.project_id where p.group_id = p_group_id
  loop
    perform taskapp.finish_project_deletion_if_agreed(v_id);
  end loop;
end;
$$;

-- 踢出小组：只有组长能踢，组长不能被踢。他在组里任何项目上有执行人或负责人时不执行（blocked）
create or replace function taskapp.remove_group_member(p_group_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
begin
  select role into v_target_role from taskapp.group_members
  where group_id = p_group_id and user_id = p_user_id;
  if not taskapp.is_group_leader(p_group_id) or v_target_role is distinct from 'member'
     or p_user_id = auth.uid() then
    raise exception '没有踢出这个人的权限' using errcode = 'insufficient_privilege';
  end if;
  if taskapp.has_ra_in_group(p_group_id, p_user_id) then
    return 'blocked';
  end if;
  perform taskapp.remove_member_now(p_group_id, p_user_id);
  return 'removed';
end;
$$;

-- 退出小组：在组里任何项目上有执行人或负责人时不能退出；管理组最后一位组长不能退出；
-- 合作组最后一个成员退出时，组和组里的全部项目、任务一起删除
create or replace function taskapp.leave_group(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := taskapp.my_group_role(p_group_id);
begin
  if v_role is null then
    raise exception '不是这个组的成员' using errcode = 'insufficient_privilege';
  end if;
  if taskapp.has_ra_in_group(p_group_id, auth.uid()) then
    return 'blocked';
  end if;
  if taskapp.group_kind(p_group_id) = 'management' and v_role = 'leader' and not exists (
    select 1 from taskapp.group_members
    where group_id = p_group_id and role = 'leader' and user_id <> auth.uid()
  ) then
    return 'last_leader';
  end if;
  perform taskapp.remove_member_now(p_group_id, auth.uid());
  if not exists (select 1 from taskapp.groups where id = p_group_id) then
    return 'deleted';
  end if;
  return 'left';
end;
$$;

-- 9. 项目：建、改、名单、加人、邀请、管理员、移出、退出、只有名字的人、删除投票 ---------------

-- 建项目（只有组长）。p_member_ids：项目成员（小组成员里的非组长；组长自动在每个项目里）
create function taskapp.create_project(
  p_group_id uuid,
  p_name text,
  p_color text,
  p_tools text[],
  p_member_ids uuid[]
)
returns taskapp.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project taskapp.projects;
begin
  if not taskapp.is_group_leader(p_group_id) then
    raise exception '只有组长可以建项目' using errcode = 'insufficient_privilege';
  end if;
  insert into taskapp.projects (group_id, name, color, tools, created_by)
  values (p_group_id, btrim(p_name), p_color,
          (select coalesce(array_agg(distinct t order by t), '{}') from unnest(coalesce(p_tools, '{}')) t),
          auth.uid())
  returning * into v_project;
  insert into taskapp.project_members (project_id, user_id, role)
  select v_project.id, m.user_id, 'member'
  from taskapp.group_members m
  where m.group_id = p_group_id and m.role = 'member' and m.user_id = any (coalesce(p_member_ids, '{}'));
  return v_project;
end;
$$;

-- 改项目名和颜色（只有组长；工具箱不能改）
create function taskapp.update_project(p_project_id uuid, p_name text, p_color text)
returns taskapp.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project taskapp.projects;
begin
  if not taskapp.is_group_leader(taskapp.project_group(p_project_id)) then
    raise exception '只有组长可以修改项目' using errcode = 'insufficient_privilege';
  end if;
  update taskapp.projects set name = btrim(p_name), color = p_color
  where id = p_project_id
  returning * into v_project;
  return v_project;
end;
$$;

-- 项目名单：组长（自动在）、管理员、成员。名字：小组成员用本组昵称，只加入了项目的人用 TaskApp 名字
create function taskapp.project_roster(p_project_id uuid)
returns table (
  user_id uuid,
  nickname text,
  is_me boolean,
  role text,
  email text,
  in_group boolean,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select id, group_id from taskapp.projects where id = p_project_id),
  people as (
    select m.user_id, 'leader' as role, true as in_group, m.joined_at
    from taskapp.group_members m join p on p.group_id = m.group_id
    where m.role = 'leader'
    union all
    select pm.user_id,
           case when pm.role = 'admin' or taskapp.group_kind(p.group_id) = 'cooperative'
                then 'admin' else 'member' end,
           exists (select 1 from taskapp.group_members m
                   where m.group_id = p.group_id and m.user_id = pm.user_id),
           pm.joined_at
    from taskapp.project_members pm join p on p.id = pm.project_id
  )
  select x.user_id,
         coalesce(gm.nickname, u.display_name),
         x.user_id = auth.uid(),
         x.role,
         u.email,
         x.in_group,
         x.joined_at
  from people x
  join p on true
  join taskapp.users u on u.id = x.user_id
  left join taskapp.group_members gm on gm.group_id = p.group_id and gm.user_id = x.user_id
  where taskapp.is_project_member(p_project_id)
  -- 同一身份里按加入时间；一起加入的（建项目时选的成员）按入组时间
  order by case x.role when 'leader' then 0 when 'admin' then 1 else 2 end,
           x.joined_at, gm.joined_at nulls last, x.user_id;
$$;

-- 往项目里加小组成员（项目管理员；直接加入，不需要对方同意）
create function taskapp.add_project_member(p_project_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not taskapp.is_project_admin(p_project_id) then
    raise exception '只有项目管理员可以往项目里加人' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from taskapp.group_members
    where group_id = taskapp.project_group(p_project_id) and user_id = p_user_id
  ) then
    raise exception '只能直接加小组成员' using errcode = 'check_violation';
  end if;
  if taskapp.is_project_member_user(p_project_id, p_user_id) then
    return 'already_member';
  end if;
  insert into taskapp.project_members (project_id, user_id, role) values (p_project_id, p_user_id, 'member');
  return 'added';
end;
$$;

-- 用邮箱往项目里加人：是小组成员就直接加入；不是就发邀请（对方在通知里同意后加入）。
-- 返回 added / invited / already_member / already_invited / self
create function taskapp.invite_to_project(p_project_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
begin
  if not taskapp.is_project_admin(p_project_id) then
    raise exception '只有项目管理员可以往项目里加人' using errcode = 'insufficient_privilege';
  end if;
  if v_email = '' then
    raise exception '邮箱不能为空' using errcode = 'check_violation';
  end if;
  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    return 'self';
  end if;
  select u.id into v_user from taskapp.users u where lower(u.email) = v_email limit 1;
  if v_user is not null and taskapp.is_project_member_user(p_project_id, v_user) then
    return 'already_member';
  end if;
  if v_user is not null and exists (
    select 1 from taskapp.group_members
    where group_id = taskapp.project_group(p_project_id) and user_id = v_user
  ) then
    insert into taskapp.project_members (project_id, user_id, role) values (p_project_id, v_user, 'member');
    return 'added';
  end if;
  insert into taskapp.project_invitations (project_id, email, invited_by)
  values (p_project_id, v_email, auth.uid())
  on conflict (project_id, email) do nothing;
  return case when found then 'invited' else 'already_invited' end;
end;
$$;

create function taskapp.accept_project_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id
  from taskapp.project_invitations
  where id = p_invitation_id and email = lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_project_id is null then
    raise exception '邀请不存在' using errcode = 'no_data_found';
  end if;
  if not taskapp.is_project_member_user(v_project_id, auth.uid()) then
    insert into taskapp.project_members (project_id, user_id, role)
    values (v_project_id, auth.uid(), 'member');
  end if;
  delete from taskapp.project_invitations where id = p_invitation_id;
  return v_project_id;
end;
$$;

create function taskapp.decline_project_invitation(p_invitation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from taskapp.project_invitations
  where id = p_invitation_id and email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- 任命 / 撤销项目管理员：只有组长；合作组里人人都是管理员，不需要任命
create function taskapp.set_project_member_role(p_project_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not taskapp.is_group_leader(taskapp.project_group(p_project_id))
     or taskapp.group_kind(taskapp.project_group(p_project_id)) <> 'management' then
    raise exception '只有组长可以任命或撤销项目管理员' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception '身份只能是管理员或成员' using errcode = 'check_violation';
  end if;
  update taskapp.project_members set role = p_role
  where project_id = p_project_id and user_id = p_user_id;
  if not found then
    raise exception '他不是这个项目的成员（组长不用任命）' using errcode = 'check_violation';
  end if;
end;
$$;

-- 把人移出项目：项目管理员能移出成员，组长还能移出管理员；组长不能被移出。
-- 开了任务分配的项目里他身上有执行人或负责人时不执行（blocked）
create function taskapp.remove_project_member(p_project_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
  v_effective text;
begin
  select role into v_target_role from taskapp.project_members
  where project_id = p_project_id and user_id = p_user_id;
  v_effective := case
    when v_target_role is null then null
    when v_target_role = 'admin'
      or taskapp.group_kind(taskapp.project_group(p_project_id)) = 'cooperative' then 'admin'
    else 'member' end;
  if v_target_role is null or p_user_id = auth.uid() or not (
    (taskapp.is_group_leader(taskapp.project_group(p_project_id)))
    or (v_effective = 'member' and taskapp.is_project_admin(p_project_id))
  ) then
    raise exception '没有把这个人移出项目的权限' using errcode = 'insufficient_privilege';
  end if;
  if taskapp.has_ra_in_project(p_project_id, p_user_id) then
    return 'blocked';
  end if;
  perform taskapp.remove_project_member_now(p_project_id, p_user_id);
  return 'removed';
end;
$$;

-- 退出项目：组长不能退出项目；身上有执行人或负责人时不能退出
create function taskapp.leave_project(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from taskapp.project_members where project_id = p_project_id and user_id = auth.uid()
  ) then
    raise exception '组长不能退出项目' using errcode = 'insufficient_privilege';
  end if;
  if taskapp.has_ra_in_project(p_project_id, auth.uid()) then
    return 'blocked';
  end if;
  perform taskapp.remove_project_member_now(p_project_id, auth.uid());
  return 'left';
end;
$$;

-- 只有名字的人（开了任务分配的项目的管理员）
create function taskapp.add_project_contact(p_project_id uuid, p_name text)
returns taskapp.project_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact taskapp.project_contacts;
begin
  if not taskapp.project_has_tool(p_project_id, 'assignment')
     or not taskapp.is_project_admin(p_project_id) then
    raise exception '没有添加的权限' using errcode = 'insufficient_privilege';
  end if;
  insert into taskapp.project_contacts (project_id, name, created_by)
  values (p_project_id, btrim(p_name), auth.uid())
  returning * into v_contact;
  return v_contact;
end;
$$;

create function taskapp.remove_project_contact(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from taskapp.project_contacts where id = p_contact_id;
  if v_project_id is null or not taskapp.is_project_admin(v_project_id) then
    raise exception '没有删除的权限' using errcode = 'insufficient_privilege';
  end if;
  delete from taskapp.project_contacts where id = p_contact_id;
end;
$$;

-- 删除项目：任何一位组长发起，发起者算同意；组里只有发起者一位组长时直接删除
create function taskapp.request_project_deletion(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not taskapp.is_group_leader(taskapp.project_group(p_project_id)) then
    raise exception '只有组长可以删除项目' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from taskapp.project_deletion_requests where project_id = p_project_id) then
    return 'already_requested';
  end if;
  insert into taskapp.project_deletion_requests (project_id, initiated_by) values (p_project_id, auth.uid());
  insert into taskapp.project_deletion_votes (project_id, user_id) values (p_project_id, auth.uid());
  if taskapp.finish_project_deletion_if_agreed(p_project_id) then
    return 'deleted';
  end if;
  return 'requested';
end;
$$;

create function taskapp.vote_project_deletion(p_project_id uuid, p_agree boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not taskapp.is_group_leader(taskapp.project_group(p_project_id)) then
    raise exception '只有组长可以投票' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from taskapp.project_deletion_requests where project_id = p_project_id) then
    return 'no_request';
  end if;
  if not p_agree then
    delete from taskapp.project_deletion_requests where project_id = p_project_id;
    return 'cancelled';
  end if;
  insert into taskapp.project_deletion_votes (project_id, user_id)
  values (p_project_id, auth.uid())
  on conflict do nothing;
  if taskapp.finish_project_deletion_if_agreed(p_project_id) then
    return 'deleted';
  end if;
  return 'agreed';
end;
$$;

-- 超时：删除组、删除项目一周，任命组长三天（不操作算同意）；任何人打开 TaskApp 时检查
create or replace function taskapp.process_group_timeouts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_request taskapp.group_leader_requests;
  v_project_id uuid;
begin
  v_count := taskapp.process_expired_group_deletions();
  for v_request in
    select * from taskapp.group_leader_requests r
    where r.started_at <= taskapp.clock_now() - interval '3 days'
      and taskapp.is_group_member(r.group_id)
  loop
    update taskapp.group_members set role = 'leader'
    where group_id = v_request.group_id and user_id = v_request.candidate_id;
    delete from taskapp.project_members pm using taskapp.projects p
    where p.id = pm.project_id and p.group_id = v_request.group_id
      and pm.user_id = v_request.candidate_id;
    delete from taskapp.group_leader_requests where id = v_request.id;
    v_count := v_count + 1;
  end loop;
  for v_project_id in
    select r.project_id from taskapp.project_deletion_requests r
    join taskapp.projects p on p.id = r.project_id
    where r.started_at <= taskapp.clock_now() - interval '7 days'
      and taskapp.is_group_participant(p.group_id)
  loop
    perform taskapp.delete_project_now(v_project_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 成了组长：项目行不再需要（组长自动在每个项目里）
create or replace function taskapp.finish_leader_request_if_agreed(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request taskapp.group_leader_requests;
begin
  select * into v_request from taskapp.group_leader_requests where id = p_request_id;
  if v_request.id is null then
    return false;
  end if;
  if exists (
    select 1 from taskapp.group_members m
    where m.group_id = v_request.group_id and m.role = 'leader'
      and not exists (
        select 1 from taskapp.group_leader_votes v
        where v.request_id = p_request_id and v.user_id = m.user_id
      )
  ) then
    return false;
  end if;
  update taskapp.group_members set role = 'leader'
  where group_id = v_request.group_id and user_id = v_request.candidate_id;
  delete from taskapp.project_members pm using taskapp.projects p
  where p.id = pm.project_id and p.group_id = v_request.group_id
    and pm.user_id = v_request.candidate_id;
  delete from taskapp.group_leader_requests where id = p_request_id;
  return true;
end;
$$;

-- 10. 通知 ------------------------------------------------------------------------------------

drop function taskapp.my_notifications();
create function taskapp.my_notifications()
returns table (
  kind text,
  id uuid,
  group_id uuid,
  group_name text,
  actor_name text,
  created_at timestamptz,
  task_id uuid,
  task_title text,
  subject_name text,
  action text,
  fields text[],
  subject_is_me boolean,
  can_confirm boolean,
  task_deleted boolean,
  project_id uuid,
  project_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- 入组邀请
  select 'group_invitation', i.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), i.created_at,
         null::uuid, null::text, null::text, null::text, null::text[], null::boolean,
         false, false, null::uuid, null::text
  from taskapp.group_invitations i
  join taskapp.groups g on g.id = i.group_id
  join taskapp.users u on u.id = i.invited_by
  left join taskapp.group_members m on m.group_id = i.group_id and m.user_id = i.invited_by
  where auth.uid() is not null
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  union all
  -- 邀请加入项目（不在小组里的人）
  select 'project_invitation', i.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), i.created_at,
         null, null, null, null, null, null, false, false, p.id, p.name
  from taskapp.project_invitations i
  join taskapp.projects p on p.id = i.project_id
  join taskapp.groups g on g.id = p.group_id
  join taskapp.users u on u.id = i.invited_by
  left join taskapp.group_members m on m.group_id = g.id and m.user_id = i.invited_by
  where auth.uid() is not null
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  union all
  -- 删除组的投票（我是组长、还没投）
  select 'group_deletion_vote', r.group_id, g.id, g.name,
         coalesce(m.nickname, u.display_name), r.started_at,
         null, null, null, null, null, null, false, false, null, null
  from taskapp.group_deletion_requests r
  join taskapp.groups g on g.id = r.group_id
  join taskapp.users u on u.id = r.initiated_by
  left join taskapp.group_members m on m.group_id = r.group_id and m.user_id = r.initiated_by
  where taskapp.my_group_role(r.group_id) = 'leader'
    and not exists (
      select 1 from taskapp.group_deletion_votes v
      where v.group_id = r.group_id and v.user_id = auth.uid()
    )
  union all
  -- 删除项目的投票（我是组长、还没投）
  select 'project_deletion_vote', r.project_id, g.id, g.name,
         coalesce(m.nickname, u.display_name), r.started_at,
         null, null, null, null, null, null, false, false, p.id, p.name
  from taskapp.project_deletion_requests r
  join taskapp.projects p on p.id = r.project_id
  join taskapp.groups g on g.id = p.group_id
  join taskapp.users u on u.id = r.initiated_by
  left join taskapp.group_members m on m.group_id = g.id and m.user_id = r.initiated_by
  where taskapp.my_group_role(g.id) = 'leader'
    and not exists (
      select 1 from taskapp.project_deletion_votes v
      where v.project_id = r.project_id and v.user_id = auth.uid()
    )
  union all
  -- 任命组长的投票（我是组长、还没投）
  select 'group_leader_vote', r.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), r.started_at,
         null, null, coalesce(cm.nickname, cu.display_name), null, null, false, false, false,
         null, null
  from taskapp.group_leader_requests r
  join taskapp.groups g on g.id = r.group_id
  join taskapp.users u on u.id = r.initiated_by
  left join taskapp.group_members m on m.group_id = r.group_id and m.user_id = r.initiated_by
  join taskapp.users cu on cu.id = r.candidate_id
  left join taskapp.group_members cm on cm.group_id = r.group_id and cm.user_id = r.candidate_id
  where taskapp.my_group_role(r.group_id) = 'leader'
    and not exists (
      select 1 from taskapp.group_leader_votes v
      where v.request_id = r.id and v.user_id = auth.uid()
    )
  union all
  -- 任务通知（我还在这个项目里）
  select 'task', n.id, g.id, g.name,
         coalesce(m.nickname, u.display_name), n.created_at,
         t.id, t.title,
         coalesce(tm.nickname, tu.display_name), n.action, n.fields,
         n.target_user_id = auth.uid(),
         n.action = 'completed' and taskapp.has_task_role(t.id, 'A')
           and t.completed_at is not null and t.confirmed_at is null and t.deleted_at is null,
         t.deleted_at is not null,
         p.id, p.name
  from taskapp.task_notifications n
  join taskapp.tasks t on t.id = n.task_id
  join taskapp.projects p on p.id = t.project_id
  join taskapp.groups g on g.id = t.group_id
  left join taskapp.users u on u.id = n.actor_id
  left join taskapp.group_members m on m.group_id = g.id and m.user_id = n.actor_id
  left join taskapp.users tu on tu.id = n.target_user_id
  left join taskapp.group_members tm on tm.group_id = g.id and tm.user_id = n.target_user_id
  where n.user_id = auth.uid()
    and n.dismissed_at is null
    and taskapp.is_project_member(p.id)
    and (t.deleted_at is null or 'deleted' = any (n.fields))
    and not (
      n.action = 'completed' and taskapp.has_task_role(t.id, 'A')
      and not (t.completed_at is not null and t.confirmed_at is null)
    )
  order by 6 desc;
$$;

-- 11. 权限 ------------------------------------------------------------------------------------

revoke execute on function
  taskapp.remove_project_member_now(uuid, uuid),
  taskapp.delete_project_now(uuid),
  taskapp.finish_project_deletion_if_agreed(uuid)
from public, anon, authenticated;

grant execute on function
  taskapp.is_group_leader(uuid),
  taskapp.project_group(uuid),
  taskapp.project_has_tool(uuid, text),
  taskapp.is_project_member_user(uuid, uuid),
  taskapp.is_project_member(uuid),
  taskapp.is_project_admin(uuid),
  taskapp.is_group_participant(uuid),
  taskapp.create_task_with_raci(uuid, text, text, timestamptz, text, timestamptz, jsonb, jsonb, jsonb),
  taskapp.member_task_roles(uuid, uuid),
  taskapp.project_member_task_roles(uuid, uuid),
  taskapp.has_ra_in_project(uuid, uuid),
  taskapp.create_project(uuid, text, text, text[], uuid[]),
  taskapp.update_project(uuid, text, text),
  taskapp.project_roster(uuid),
  taskapp.add_project_member(uuid, uuid),
  taskapp.invite_to_project(uuid, text),
  taskapp.accept_project_invitation(uuid),
  taskapp.decline_project_invitation(uuid),
  taskapp.set_project_member_role(uuid, uuid, text),
  taskapp.remove_project_member(uuid, uuid),
  taskapp.leave_project(uuid),
  taskapp.add_project_contact(uuid, text),
  taskapp.remove_project_contact(uuid),
  taskapp.request_project_deletion(uuid),
  taskapp.vote_project_deletion(uuid, boolean),
  taskapp.my_notifications()
to authenticated;

commit;
