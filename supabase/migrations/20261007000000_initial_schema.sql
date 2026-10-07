-- Alethego Tasks 初始结构（taskapp schema）。
--
-- 由 2026-09-25 至 2026-10-05 的 14 份迁移合并而成：去掉了过渡和兼容的内容，命名统一，行为与合并前完全一致。
--
-- 硬规定：从这份初始结构起，数据库的任何改动都必须是一份新的迁移，在现有结构上修改，保留现有数据；
-- 不允许清空数据、删库重建。需要改变现有数据的形状时，迁移里要带上数据转换。
--
-- 账号由 Alethego 签发（Third-Party Auth），auth.uid() 是 Alethego 的用户 id；
-- 本 schema 只建在 taskapp 里，不碰 public、auth 或其他 schema。

create schema if not exists taskapp;

-- 函数体里引用的表在后面才建
set check_function_bodies = false;

-- 1. 类型与基础函数 ---------------------------------------------------------------------------

create type taskapp.occurrence_status as enum ('pending', 'completed', 'missed');

create function taskapp.clock_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

create function taskapp.current_owner_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid();
$$;

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

-- 2. 表 ---------------------------------------------------------------------------------------

create table taskapp.users (
  id                    uuid primary key default auth.uid(),
  email                 text,
  display_name          text not null
                        constraint users_display_name_not_blank check (btrim(display_name) <> ''),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- 通知：上次打开通知的时间，之后出现的通知算未读
  notifications_seen_at timestamptz
);

create table taskapp.groups (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null
             constraint groups_kind_check check (kind in ('cooperative', 'management', 'education')),
  name       text not null
             constraint groups_name_not_blank check (btrim(name) <> ''),
  created_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  color      text
             constraint groups_color_format check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);

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

create table taskapp.tasks (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default taskapp.current_owner_id() references taskapp.users (id),
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
  -- 任务标星：只是书签，不影响矩阵位置、排序或任何其他规则
  is_starred         boolean not null default false,
  group_id           uuid references taskapp.groups (id) on delete cascade,
  confirmed_at       timestamptz,
  project_id         uuid references taskapp.projects (id) on delete cascade,
  start_on           date,
  end_after_days     integer
                     constraint tasks_end_after_days_range check (end_after_days between 0 and 3650),
  date_zone          text,

  constraint tasks_confirmed_requires_completed
    check (confirmed_at is null or completed_at is not null),
  -- 组里不使用重要性和收藏
  constraint tasks_group_fields
    check ( group_id is null or (importance_level = 0 and not is_starred) ),
  constraint tasks_project_container
    check ((group_id is null) = (project_id is null)),
  -- 循环开关打开时必须有起始时间；关闭（清空规则）时可保留起始时间
  constraint tasks_recurrence_requires_dtstart
    check (recurrence_rule is null or recurrence_dtstart is not null)
);
comment on column taskapp.tasks.importance_level is '重要性 0-5：0 = 未设置，1-5 为用户设置的档位';
comment on column taskapp.tasks.recurrence_rule is 'RFC 5545 RRULE；非空即为循环任务';
comment on column taskapp.tasks.is_starred is '标星（书签），默认 false';
comment on column taskapp.tasks.confirmed_at is '已确认的时间。个人任务、合作组任务完成即确认；管理组任务由 A 确认（completed_at 有值而它为空 = 待确认）';

create table taskapp.categories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default taskapp.current_owner_id() references taskapp.users (id),
  name        text not null,
  color       text not null
              constraint categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at  timestamptz not null default now(),
  -- 分类描述：可选的自由文本，默认空字符串。
  description text not null default '',
  -- 个人分类的工具箱：只有任务关系；建好后不能改
  tools       text[] not null default '{}'
              constraint categories_tools_check check (tools <@ array['relations'])
);
comment on column taskapp.categories.description is '分类描述，自由文本，可为空字符串';

create table taskapp.task_categories (
  task_id     uuid not null references taskapp.tasks (id) on delete cascade,
  category_id uuid not null references taskapp.categories (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint task_categories_pkey
    primary key (task_id, category_id)
);

create table taskapp.recurrence_occurrences (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references taskapp.tasks (id) on delete cascade,
  occurrence_date timestamptz not null,
  status          taskapp.occurrence_status not null default 'pending',
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),

  constraint recurrence_occurrences_task_date_key
    unique (task_id, occurrence_date)
);
comment on column taskapp.recurrence_occurrences.status is 'pending = 已出现未判定；missed = 下一实例出现时仍未完成，系统自动归档，用户可事后修改';

-- 地点：一个任务至多一个地点（task_id 即主键）
create table taskapp.task_locations (
  task_id    uuid primary key references taskapp.tasks (id) on delete cascade,
  name       text not null default '',
  address    text not null default '',
  place_id   text,
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_locations_coordinates
    check ( (lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180) ),
  -- 没有任何内容的地点不应存在（清空地点 = 删除这一行）
  constraint task_locations_not_empty
    check (btrim(name) <> '' or btrim(address) <> '' or place_id is not null)
);

-- 人物：一个任务可关联多个人
create table taskapp.task_people (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references taskapp.tasks (id) on delete cascade,
  name       text not null
             constraint task_people_name_not_blank check (btrim(name) <> ''),
  relation   text not null default '',
  contact_id text,
  created_at timestamptz not null default now()
);

-- 名单。合作组里所有成员都是组长（role = 'leader'）。
-- nickname 只在本组显示；为 null 时显示他的 TaskApp 名字（users.display_name）。
create table taskapp.group_members (
  group_id  uuid not null references taskapp.groups (id) on delete cascade,
  user_id   uuid not null references taskapp.users (id),
  role      text not null default 'member'
            constraint group_members_role_check check (role in ('leader', 'member')),
  nickname  text
            constraint group_members_nickname_not_blank check (nickname is null or btrim(nickname) <> ''),
  joined_at timestamptz not null default now(),

  constraint group_members_pkey
    primary key (group_id, user_id)
);

-- 邀请：按邮箱邀请，不发邮件；被邀请的人登录后在通知里看到（从没用过 TaskApp 也一样）。
-- 同意 = 成为成员并删除邀请；拒绝 = 删除邀请。
create table taskapp.group_invitations (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references taskapp.groups (id) on delete cascade,
  email      text not null
             constraint group_invitations_email_normalized check (email = lower(btrim(email)) and email <> ''),
  invited_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default taskapp.clock_now(),

  constraint group_invitations_group_id_email_key
    unique (group_id, email)
);

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

  constraint group_deletion_votes_pkey
    primary key (group_id, user_id)
);

create table taskapp.project_contacts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references taskapp.projects (id) on delete cascade,
  name       text not null
             constraint project_contacts_name_not_blank check (btrim(name) <> ''),
  created_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default now()
);

create table taskapp.task_assignments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references taskapp.tasks (id) on delete cascade,
  role       text not null
             constraint task_assignments_role_check check (role in ('R', 'A', 'C', 'I')),
  user_id    uuid references taskapp.users (id),
  contact_id uuid references taskapp.project_contacts (id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint task_assignments_one_target
    check ((user_id is null) <> (contact_id is null)),
  constraint task_assignments_ra_members
    check (role in ('C', 'I') or user_id is not null)
);

create table taskapp.task_notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references taskapp.users (id),
  task_id        uuid not null references taskapp.tasks (id) on delete cascade,
  actor_id       uuid references taskapp.users (id),
  created_at     timestamptz not null default taskapp.clock_now(),
  dismissed_at   timestamptz,
  action         text not null
                 constraint task_notifications_action_check check (action in ('assigned', 'completed', 'confirmed', 'rejected', 'modified')),
  target_user_id uuid references taskapp.users (id),
  fields         text[] not null default '{}'
);

create table taskapp.group_leader_requests (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references taskapp.groups (id) on delete cascade,
  candidate_id uuid not null references taskapp.users (id),
  initiated_by uuid not null references taskapp.users (id),
  started_at   timestamptz not null default taskapp.clock_now(),

  constraint group_leader_requests_group_id_candidate_id_key
    unique (group_id, candidate_id)
);

create table taskapp.group_leader_votes (
  request_id uuid not null references taskapp.group_leader_requests (id) on delete cascade,
  user_id    uuid not null references taskapp.users (id),
  voted_at   timestamptz not null default taskapp.clock_now(),

  constraint group_leader_votes_pkey
    primary key (request_id, user_id)
);

-- 项目成员（组长不在这里：组长自动在每个项目里）
create table taskapp.project_members (
  project_id uuid not null references taskapp.projects (id) on delete cascade,
  user_id    uuid not null references taskapp.users (id),
  role       text not null default 'member'
             constraint project_members_role_check check (role in ('admin', 'member')),
  joined_at  timestamptz not null default now(),

  constraint project_members_pkey
    primary key (project_id, user_id)
);

-- 邀请不在小组里的人加入项目（对方在通知里同意后加入）
create table taskapp.project_invitations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references taskapp.projects (id) on delete cascade,
  email      text not null
             constraint project_invitations_email_normalized check (email = lower(btrim(email)) and email <> ''),
  invited_by uuid not null references taskapp.users (id),
  created_at timestamptz not null default taskapp.clock_now(),

  constraint project_invitations_project_id_email_key
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

  constraint project_deletion_votes_pkey
    primary key (project_id, user_id)
);

create table taskapp.task_relations (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references taskapp.tasks (id) on delete cascade,
  side           text not null
                 constraint task_relations_side_check check (side in ('start', 'end')),
  predecessor_id uuid not null references taskapp.tasks (id) on delete cascade,
  anchor         text not null
                 constraint task_relations_anchor_check check (anchor in ('start', 'end')),
  offset_days    integer not null default 0
                 constraint task_relations_offset_range check (offset_days between -3650 and 3650),
  created_at     timestamptz not null default now(),

  constraint task_relations_not_self
    check (task_id <> predecessor_id),
  constraint task_relations_task_id_side_predecessor_id_anchor_key
    unique (task_id, side, predecessor_id, anchor)
);

-- 3. 索引 -------------------------------------------------------------------------------------

create index group_invitations_email_idx on taskapp.group_invitations (email);

create index group_members_user_id_idx on taskapp.group_members (user_id);

create index project_contacts_project_id_idx on taskapp.project_contacts (project_id);

create index project_members_user_id_idx on taskapp.project_members (user_id);

create index projects_group_id_idx on taskapp.projects (group_id);

create unique index task_assignments_contact_key
  on taskapp.task_assignments (task_id, role, contact_id) where contact_id is not null;

create index task_assignments_user_id_idx on taskapp.task_assignments (user_id);

create unique index task_assignments_user_key
  on taskapp.task_assignments (task_id, role, user_id) where user_id is not null;

-- 主键已覆盖按 task_id 查询；按分类筛选任务需要反向索引
create index task_categories_category_id_idx on taskapp.task_categories (category_id);

create index task_notifications_user_idx
  on taskapp.task_notifications (user_id) where dismissed_at is null;

create index task_people_task_id_idx on taskapp.task_people (task_id);

create index task_relations_predecessor_idx on taskapp.task_relations (predecessor_id);

create index tasks_group_id_idx on taskapp.tasks (group_id) where group_id is not null;

-- 列表默认排序：截止时间从近到远，无截止时间排最后；只索引未删除的任务
create index tasks_owner_deadline_idx on taskapp.tasks (owner_id, deadline_at asc nulls last)
  where deleted_at is null;

create index tasks_project_id_idx on taskapp.tasks (project_id) where project_id is not null;

-- 4. 函数：任务、分类、循环任务的权限辅助 -----------------------------------------------------

-- 个人任务：只认个人任务（分类只属于个人，task_categories 用它）
create function taskapp.owns_task(p_task_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t
    where t.id = p_task_id
      and t.group_id is null
      and t.owner_id = (select taskapp.current_owner_id())
  );
$$;

create function taskapp.owns_category(p_category_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.categories c
    where c.id = p_category_id and c.owner_id = (select taskapp.current_owner_id())
  );
$$;

-- 5. 函数：用户 -------------------------------------------------------------------------------

-- 登录后、访问任何业务数据之前调用：还没有这一行就创建（display_name 取传入的默认值），
-- 已有则只更新 email。以调用者身份执行（security invoker），仍受 RLS 约束。
create function taskapp.ensure_current_user(p_email text, p_display_name text)
returns taskapp.users
language sql
set search_path = ''
as $$
  insert into taskapp.users (id, email, display_name)
  values (auth.uid(), p_email, p_display_name)
  on conflict (id) do update set email = excluded.email
  returning *;
$$;

-- 6. 函数：组：建组、邀请、删除组 -------------------------------------------------------------

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

-- 任务不能在个人、组、项目之间移动
create function taskapp.tasks_container_immutable()
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

create function taskapp.can_access_task(p_task_id uuid)
returns boolean
language sql
stable
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

-- 内部：删除组（连同组里的全部任务；任务的循环记录、人物、地点随任务级联删除）
create function taskapp.delete_group_now(p_group_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from taskapp.groups where id = p_group_id;
$$;

create function taskapp.group_roster(p_group_id uuid)
returns table (user_id uuid, nickname text, has_custom_nickname boolean, is_me boolean, joined_at timestamptz, role text, email text)
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

-- 只有组长能邀请人进小组。被邀请的人：合作组里是组长，管理组里是成员
create function taskapp.invite_to_group(p_group_id uuid, p_email text)
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

create function taskapp.decline_group_invitation(p_invitation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from taskapp.group_invitations
  where id = p_invitation_id and email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

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

create function taskapp.my_notifications()
returns table (kind text, id uuid, group_id uuid, group_name text, actor_name text, created_at timestamptz, task_id uuid, task_title text, subject_name text, action text, fields text[], subject_is_me boolean, can_confirm boolean, task_deleted boolean, project_id uuid, project_name text)
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

-- 7. 函数：组的身份、任命组长、离开与踢出、超时 -----------------------------------------------

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
        or (t.project_id is not null and taskapp.is_project_admin(t.project_id))
      )
  );
$$;

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

create function taskapp.tasks_completion_rules()
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
      new.deleted_at, new.owner_id, new.start_on, new.end_after_days)
     is distinct from
     (old.title, old.description, old.deadline_at, old.recurrence_rule, old.recurrence_dtstart,
      old.deleted_at, old.owner_id, old.start_on, old.end_after_days)
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
create function taskapp.occurrence_completion_rules()
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

-- 任务通知只在开了任务分配的项目里发
create function taskapp.tasks_notify_changes()
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

create function taskapp.create_group(p_name text, p_kind text, p_color text)
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

create function taskapp.set_task_raci(p_task_id uuid, p_assignments jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select taskapp.apply_task_raci(p_task_id, p_assignments, false);
$$;

-- 成了组长：项目行不再需要（组长自动在每个项目里）
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
  delete from taskapp.project_members pm using taskapp.projects p
  where p.id = pm.project_id and p.group_id = v_request.group_id
    and pm.user_id = v_request.candidate_id;
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

-- 内部：把某人移出小组（同时移出组里的全部项目，RACI 一并去掉；他的投票作废），
-- 然后看剩下的组长是不是都同意了正在进行的投票
create function taskapp.remove_member_now(p_group_id uuid, p_user_id uuid)
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

-- 踢出小组：只有组长能踢，组长不能被踢。他在组里任何项目上有执行人或负责人时不执行（blocked）
create function taskapp.remove_group_member(p_group_id uuid, p_user_id uuid)
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

-- 超时：删除组、删除项目一周，任命组长三天（不操作算同意）；任何人打开 TaskApp 时检查
create function taskapp.process_group_timeouts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_group_id uuid;
  v_request taskapp.group_leader_requests;
  v_project_id uuid;
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

-- 8. 函数：RACI 与通知 ------------------------------------------------------------------------

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

-- 任务通知只发给这个项目的成员
create function taskapp.notify_task(p_user_id uuid, p_action text, p_task_id uuid, p_target uuid default null, p_fields text[] default '{}')
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

-- 内部：通知任务上某几种身份的成员
create function taskapp.notify_task_roles(p_task_id uuid, p_roles text[], p_action text, p_target uuid default null, p_fields text[] default '{}')
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
    perform taskapp.notify_task(v_user, p_action, p_task_id, p_target, p_fields);
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

create function taskapp.task_extension_notify_changes()
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

-- 设 RACI：开了任务分配的项目的管理员；R、A、C、I 里的成员必须是项目成员，只有名字的人必须是这个项目的
create function taskapp.apply_task_raci(p_task_id uuid, p_assignments jsonb, p_is_new boolean)
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
    perform taskapp.notify_task(v_user, 'assigned', p_task_id, v_user);
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

-- 开了任务分配的项目：未删除的任务必须有执行人和负责人
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

create function taskapp.create_task_with_raci(p_project_id uuid, p_title text, p_description text, p_deadline_at timestamptz, p_recurrence_rule text, p_recurrence_dtstart timestamptz, p_assignments jsonb, p_location jsonb default null, p_people jsonb default '[]')
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

-- 9. 函数：项目与工具箱 -----------------------------------------------------------------------

create function taskapp.is_group_leader(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(taskapp.my_group_role(p_group_id) = 'leader', false);
$$;

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

-- 建项目（只有组长）。p_member_ids：项目成员（小组成员里的非组长；组长自动在每个项目里）
create function taskapp.create_project(p_group_id uuid, p_name text, p_color text, p_tools text[], p_member_ids uuid[])
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
returns table (user_id uuid, nickname text, is_me boolean, role text, email text, in_group boolean, joined_at timestamptz)
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

-- 10. 函数：任务关系 --------------------------------------------------------------------------

-- 这条任务有没有"任务关系"：项目开了任务关系，或者个人任务挂了开了任务关系的分类；循环任务没有
create function taskapp.task_has_relations(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t
    where t.id = p_task_id and t.recurrence_rule is null and (
      (t.project_id is not null and taskapp.project_has_tool(t.project_id, 'relations'))
      or (t.project_id is null and exists (
        select 1 from taskapp.task_categories tc
        join taskapp.categories c on c.id = tc.category_id
        where tc.task_id = t.id and 'relations' = any (c.tools)
      ))
    )
  );
$$;

-- 某条任务在关系里的日期（按 p_zone 时区换算截止时间）：结束 = 截止时间所在的日期；
-- 开始 = start_on，没有开始时按结束日期（里程碑）
create function taskapp.task_anchor_date(p_task_id uuid, p_anchor text, p_zone text)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_anchor = 'start' then coalesce(
      t.start_on,
      (t.deadline_at at time zone coalesce(p_zone, 'UTC'))::date
    )
    else (t.deadline_at at time zone coalesce(p_zone, 'UTC'))::date
  end
  from taskapp.tasks t
  where t.id = p_task_id and t.deleted_at is null and t.recurrence_rule is null;
$$;

-- 某个日期在某时区的最后一刻（和前端"没选时刻 = 当天最后一刻"一致）
create function taskapp.end_of_local_day(p_day date, p_zone text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((p_day + 1)::timestamp at time zone coalesce(p_zone, 'UTC')) - interval '1 millisecond';
$$;

-- 一行（开始 / 结束）上所有关系里最晚的日期；关系对象没有日期的不算；一个都算不出来时为空
create function taskapp.relation_side_date(p_task_id uuid, p_side text, p_zone text)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select max(taskapp.task_anchor_date(r.predecessor_id, r.anchor, p_zone) + r.offset_days)
  from taskapp.task_relations r
  where r.task_id = p_task_id and r.side = p_side;
$$;

-- 写入任务时：填了关系的那一行由数据库算出日期（直接改这些字段也会被算出来的值覆盖）。
-- 循环任务不能有关系，也不能是别的任务的关系对象
create function taskapp.tasks_schedule_compute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_end date;
begin
  if new.recurrence_rule is not null then
    if tg_op = 'UPDATE' and old.recurrence_rule is null and exists (
      select 1 from taskapp.task_relations where task_id = new.id or predecessor_id = new.id
    ) then
      raise exception '有任务关系的任务不能设为循环任务' using errcode = 'check_violation';
    end if;
    new.start_on := null;
    new.end_after_days := null;
    return new;
  end if;
  if tg_op = 'INSERT' or not taskapp.task_has_relations(new.id) then
    return new;
  end if;

  if exists (select 1 from taskapp.task_relations where task_id = new.id and side = 'start') then
    new.start_on := taskapp.relation_side_date(new.id, 'start', new.date_zone);
  end if;
  v_start := new.start_on;

  if new.end_after_days is not null then
    v_end := v_start + new.end_after_days;
    new.deadline_at := case when v_end is null then null
                            else taskapp.end_of_local_day(v_end, new.date_zone) end;
  elsif exists (select 1 from taskapp.task_relations where task_id = new.id and side = 'end') then
    v_end := taskapp.relation_side_date(new.id, 'end', new.date_zone);
    new.deadline_at := case when v_end is null then null
                            else taskapp.end_of_local_day(v_end, new.date_zone) end;
  end if;
  return new;
end;
$$;

-- 重新计算某条任务（"碰一下"它，由 tasks_schedule_compute 触发器算出新日期）
create function taskapp.recompute_task_schedule(p_task_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update taskapp.tasks set start_on = start_on where id = p_task_id;
$$;

-- 日期变了（或者删除 / 恢复）：依赖它的任务逐层重新计算
create function taskapp.tasks_schedule_cascade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select distinct task_id from taskapp.task_relations where predecessor_id = new.id loop
    perform taskapp.recompute_task_schedule(v_id);
  end loop;
  return null;
end;
$$;

-- 关系对象被彻底删除（例如删除项目）时，关系一并删掉，依赖它的任务重新计算
create function taskapp.task_relations_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform taskapp.recompute_task_schedule(old.task_id);
  return null;
end;
$$;

-- 加上 p_predecessor 作为 p_task 的关系对象会不会形成循环：从关系对象往上找，能找回这条任务就是循环
create function taskapp.relation_creates_cycle(p_task_id uuid, p_predecessor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up(id) as (
    select p_predecessor_id
    union
    select r.predecessor_id from taskapp.task_relations r join up on r.task_id = up.id
  )
  select p_task_id = p_predecessor_id or exists (select 1 from up where id = p_task_id);
$$;

-- 能不能把 p_predecessor 选为 p_task 的关系对象：
--   组里：同一个组、开了任务关系的项目里、我能看到的任务；个人：同一个人、挂了开有任务关系的分类的个人任务。
--   不能跨组，不能在个人和组之间关联；循环任务、已删除的任务不行
create function taskapp.can_relate_tasks(p_task_id uuid, p_predecessor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.tasks t, taskapp.tasks p
    where t.id = p_task_id and p.id = p_predecessor_id
      and p.deleted_at is null
      and taskapp.task_has_relations(p.id)
      and (
        (t.group_id is not null and p.group_id = t.group_id and taskapp.is_project_member(p.project_id))
        or (t.group_id is null and p.group_id is null and p.owner_id = t.owner_id)
      )
  );
$$;

-- 一次设定一条任务的开始和结束（整组替换关系）。
-- p_start_on：开始是固定日期时的日期（有开始关系时忽略）；p_end_after_days：结束是"开始后 N 天"时的 N；
-- p_start_relations / p_end_relations：[{predecessor_id, anchor, offset_days}]；
-- 结束是固定日期时不在这里设，截止时间照常写在任务上。p_date_zone：用户的时区
create function taskapp.set_task_schedule(p_task_id uuid, p_start_on date, p_start_relations jsonb, p_end_after_days integer, p_end_relations jsonb, p_date_zone text)
returns taskapp.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_side text;
  v_list jsonb;
  v_pred uuid;
  v_task taskapp.tasks;
begin
  if not taskapp.can_edit_task(p_task_id) then
    raise exception '没有编辑这个任务的权限' using errcode = 'insufficient_privilege';
  end if;
  if not taskapp.task_has_relations(p_task_id) then
    raise exception '这个任务没有任务关系' using errcode = 'check_violation';
  end if;
  if p_end_after_days is not null and jsonb_array_length(coalesce(p_end_relations, '[]')) > 0 then
    raise exception '结束只能选一种' using errcode = 'check_violation';
  end if;
  if p_date_zone is not null and not exists (select 1 from pg_timezone_names where name = p_date_zone) then
    raise exception '时区不对：%', p_date_zone using errcode = 'check_violation';
  end if;

  delete from taskapp.task_relations where task_id = p_task_id;
  foreach v_side in array array['start', 'end'] loop
    v_list := case v_side when 'start' then p_start_relations else p_end_relations end;
    for v_item in select * from jsonb_array_elements(coalesce(v_list, '[]'::jsonb)) loop
      v_pred := (v_item ->> 'predecessor_id')::uuid;
      if not taskapp.can_relate_tasks(p_task_id, v_pred) then
        raise exception '不能选这个任务' using errcode = 'check_violation';
      end if;
      if taskapp.relation_creates_cycle(p_task_id, v_pred) then
        raise exception '任务关系不能形成循环' using errcode = 'check_violation';
      end if;
      insert into taskapp.task_relations (task_id, side, predecessor_id, anchor, offset_days)
      values (p_task_id, v_side, v_pred, coalesce(v_item ->> 'anchor', 'end'),
              coalesce((v_item ->> 'offset_days')::integer, 0))
      on conflict (task_id, side, predecessor_id, anchor)
      do update set offset_days = excluded.offset_days;
    end loop;
  end loop;

  update taskapp.tasks
  set start_on = p_start_on,
      end_after_days = p_end_after_days,
      date_zone = coalesce(p_date_zone, date_zone)
  where id = p_task_id
  returning * into v_task;
  return v_task;
end;
$$;

-- 11. 触发器 ----------------------------------------------------------------------------------

create trigger categories_tools_immutable
  before update on taskapp.categories
  for each row execute function taskapp.categories_tools_immutable();

create trigger groups_kind_immutable
  before update on taskapp.groups
  for each row execute function taskapp.groups_kind_immutable();

create trigger groups_set_updated_at
  before update on taskapp.groups
  for each row execute function taskapp.set_updated_at();

create trigger projects_immutable_fields
  before update on taskapp.projects
  for each row execute function taskapp.projects_immutable_fields();

create trigger projects_set_updated_at
  before update on taskapp.projects
  for each row execute function taskapp.set_updated_at();

create trigger occurrence_completion_rules
  before insert or update on taskapp.recurrence_occurrences
  for each row execute function taskapp.occurrence_completion_rules();

create constraint trigger task_assignments_require_ra
  after update or delete on taskapp.task_assignments
  deferrable initially deferred
  for each row execute function taskapp.check_task_has_ra();

create trigger task_locations_notify_changes
  after insert or update or delete on taskapp.task_locations
  for each row execute function taskapp.task_extension_notify_changes();

create trigger task_locations_set_updated_at
  before update on taskapp.task_locations
  for each row execute function taskapp.set_updated_at();

create trigger task_people_notify_changes
  after insert or update or delete on taskapp.task_people
  for each row execute function taskapp.task_extension_notify_changes();

create trigger task_relations_after_delete
  after delete on taskapp.task_relations
  for each row execute function taskapp.task_relations_after_delete();

create trigger tasks_completion_rules
  before insert or update on taskapp.tasks
  for each row execute function taskapp.tasks_completion_rules();

create trigger tasks_container_immutable
  before update on taskapp.tasks
  for each row execute function taskapp.tasks_container_immutable();

create trigger tasks_group_from_project
  before insert on taskapp.tasks
  for each row execute function taskapp.tasks_group_from_project();

create trigger tasks_notify_changes
  after update on taskapp.tasks
  for each row execute function taskapp.tasks_notify_changes();

create constraint trigger tasks_require_ra
  after insert on taskapp.tasks
  deferrable initially deferred
  for each row execute function taskapp.check_task_has_ra();

create trigger tasks_schedule_cascade
  after update on taskapp.tasks
  for each row
  when (
    old.start_on is distinct from new.start_on
    or old.deadline_at is distinct from new.deadline_at
    or old.date_zone is distinct from new.date_zone
    or old.deleted_at is distinct from new.deleted_at
  )
  execute function taskapp.tasks_schedule_cascade();

create trigger tasks_schedule_compute
  before update on taskapp.tasks
  for each row execute function taskapp.tasks_schedule_compute();

create trigger tasks_set_updated_at
  before update on taskapp.tasks
  for each row execute function taskapp.set_updated_at();

create trigger users_set_updated_at
  before update on taskapp.users
  for each row execute function taskapp.set_updated_at();

-- 12. 行级安全（RLS） -------------------------------------------------------------------------

alter table taskapp.categories enable row level security;
alter table taskapp.group_deletion_requests enable row level security;
alter table taskapp.group_deletion_votes enable row level security;
alter table taskapp.group_invitations enable row level security;
alter table taskapp.group_leader_requests enable row level security;
alter table taskapp.group_leader_votes enable row level security;
alter table taskapp.group_members enable row level security;
alter table taskapp.groups enable row level security;
alter table taskapp.project_contacts enable row level security;
alter table taskapp.project_deletion_requests enable row level security;
alter table taskapp.project_deletion_votes enable row level security;
alter table taskapp.project_invitations enable row level security;
alter table taskapp.project_members enable row level security;
alter table taskapp.projects enable row level security;
alter table taskapp.recurrence_occurrences enable row level security;
alter table taskapp.task_assignments enable row level security;
alter table taskapp.task_categories enable row level security;
alter table taskapp.task_locations enable row level security;
alter table taskapp.task_notifications enable row level security;
alter table taskapp.task_people enable row level security;
alter table taskapp.task_relations enable row level security;
alter table taskapp.tasks enable row level security;
alter table taskapp.users enable row level security;

create policy "categories_delete_own" on taskapp.categories
  for delete to authenticated
  using (owner_id = (select taskapp.current_owner_id()));

create policy "categories_insert_own" on taskapp.categories
  for insert to authenticated
  with check (owner_id = (select taskapp.current_owner_id()));

create policy "categories_select_own" on taskapp.categories
  for select to authenticated
  using (owner_id = (select taskapp.current_owner_id()));

create policy "categories_update_own" on taskapp.categories
  for update to authenticated
  using (owner_id = (select taskapp.current_owner_id()))
  with check (owner_id = (select taskapp.current_owner_id()));

create policy "group_deletion_requests_select_member" on taskapp.group_deletion_requests
  for select to authenticated using (taskapp.is_group_member(group_id));

create policy "group_deletion_votes_select_member" on taskapp.group_deletion_votes
  for select to authenticated using (taskapp.is_group_member(group_id));

-- 组里的成员看得到本组的邀请；被邀请的人看得到发给自己邮箱的邀请
create policy "group_invitations_select" on taskapp.group_invitations
  for select to authenticated
  using (
    taskapp.is_group_member(group_id)
    or email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "group_leader_requests_select_member" on taskapp.group_leader_requests
  for select to authenticated using (taskapp.is_group_member(group_id));

create policy "group_leader_votes_select_member" on taskapp.group_leader_votes
  for select to authenticated
  using (exists (
    select 1 from taskapp.group_leader_requests r
    where r.id = request_id and taskapp.is_group_member(r.group_id)
  ));

create policy "group_members_select_member" on taskapp.group_members
  for select to authenticated using (taskapp.is_group_member(group_id));

-- 每个成员只能改自己在本组的昵称（列级授权只开放 nickname）
create policy "group_members_update_self" on taskapp.group_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "groups_select_participant" on taskapp.groups
  for select to authenticated using (taskapp.is_group_participant(id));

create policy "project_contacts_select_member" on taskapp.project_contacts
  for select to authenticated using (taskapp.is_project_member(project_id));

create policy "project_deletion_requests_select_member" on taskapp.project_deletion_requests
  for select to authenticated using (taskapp.is_project_member(project_id));

create policy "project_deletion_votes_select_member" on taskapp.project_deletion_votes
  for select to authenticated using (taskapp.is_project_member(project_id));

create policy "project_invitations_select" on taskapp.project_invitations
  for select to authenticated
  using (
    taskapp.is_project_admin(project_id)
    or email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "project_members_select_member" on taskapp.project_members
  for select to authenticated using (taskapp.is_project_member(project_id));

create policy "projects_select_member" on taskapp.projects
  for select to authenticated using (taskapp.is_project_member(id));

create policy "recurrence_occurrences_insert" on taskapp.recurrence_occurrences
  for insert to authenticated with check (taskapp.can_access_task(task_id));

create policy "recurrence_occurrences_select" on taskapp.recurrence_occurrences
  for select to authenticated using (taskapp.can_access_task(task_id));

create policy "recurrence_occurrences_update" on taskapp.recurrence_occurrences
  for update to authenticated
  using (taskapp.can_access_task(task_id)) with check (taskapp.can_access_task(task_id));

-- 组里所有成员都能看到每条任务上的 RACI
create policy "task_assignments_select" on taskapp.task_assignments
  for select to authenticated using (taskapp.can_access_task(task_id));

create policy "task_categories_delete_own" on taskapp.task_categories
  for delete to authenticated
  using (taskapp.owns_task(task_id) and taskapp.owns_category(category_id));

create policy "task_categories_insert_own" on taskapp.task_categories
  for insert to authenticated
  with check (taskapp.owns_task(task_id) and taskapp.owns_category(category_id));

create policy "task_categories_select_own" on taskapp.task_categories
  for select to authenticated
  using (taskapp.owns_task(task_id) and taskapp.owns_category(category_id));

create policy "task_locations_delete" on taskapp.task_locations
  for delete to authenticated using (taskapp.can_edit_task(task_id));

create policy "task_locations_insert" on taskapp.task_locations
  for insert to authenticated with check (taskapp.can_edit_task(task_id));

create policy "task_locations_select" on taskapp.task_locations
  for select to authenticated using (taskapp.can_access_task(task_id));

create policy "task_locations_update" on taskapp.task_locations
  for update to authenticated
  using (taskapp.can_edit_task(task_id)) with check (taskapp.can_edit_task(task_id));

create policy "task_notifications_select_own" on taskapp.task_notifications
  for select to authenticated using (user_id = auth.uid());

create policy "task_people_delete" on taskapp.task_people
  for delete to authenticated using (taskapp.can_edit_task(task_id));

create policy "task_people_insert" on taskapp.task_people
  for insert to authenticated with check (taskapp.can_edit_task(task_id));

create policy "task_people_select" on taskapp.task_people
  for select to authenticated using (taskapp.can_access_task(task_id));

create policy "task_people_update" on taskapp.task_people
  for update to authenticated
  using (taskapp.can_edit_task(task_id)) with check (taskapp.can_edit_task(task_id));

create policy "task_relations_select" on taskapp.task_relations
  for select to authenticated using (taskapp.can_access_task(task_id));

create policy "tasks_insert" on taskapp.tasks
  for insert to authenticated
  with check (
    owner_id = (select taskapp.current_owner_id())
    and (project_id is null or taskapp.is_project_admin(project_id))
  );

create policy "tasks_select" on taskapp.tasks
  for select to authenticated
  using (
    (group_id is null and owner_id = (select taskapp.current_owner_id()))
    or (project_id is not null and taskapp.is_project_member(project_id))
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

create policy "users_insert_own" on taskapp.users
  for insert to authenticated
  with check (id = (select taskapp.current_owner_id()));

create policy "users_select_own" on taskapp.users
  for select to authenticated
  using (id = (select taskapp.current_owner_id()));

create policy "users_update_own" on taskapp.users
  for update to authenticated
  using (id = (select taskapp.current_owner_id()))
  with check (id = (select taskapp.current_owner_id()));

-- 13. 授权 ------------------------------------------------------------------------------------

-- Data API（PostgREST）用这三个角色访问 taskapp；能看到哪些行由上面的 RLS 决定
grant usage on schema taskapp to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema taskapp to anon, authenticated, service_role;
grant execute on all functions in schema taskapp to anon, authenticated, service_role;
alter default privileges in schema taskapp
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema taskapp
  grant execute on functions to anon, authenticated, service_role;

-- 组、项目、RACI、通知、任务关系相关的表：前端只能读，写都经过函数（在函数里检查身份）
revoke insert, update, delete on taskapp.group_deletion_requests from anon, authenticated;
revoke insert, update, delete on taskapp.group_deletion_votes from anon, authenticated;
revoke insert, update, delete on taskapp.group_invitations from anon, authenticated;
revoke insert, update, delete on taskapp.group_leader_requests from anon, authenticated;
revoke insert, update, delete on taskapp.group_leader_votes from anon, authenticated;
revoke insert, update, delete on taskapp.group_members from anon, authenticated;
revoke insert, update, delete on taskapp.groups from anon, authenticated;
revoke insert, update, delete on taskapp.project_contacts from anon, authenticated;
revoke insert, update, delete on taskapp.project_deletion_requests from anon, authenticated;
revoke insert, update, delete on taskapp.project_deletion_votes from anon, authenticated;
revoke insert, update, delete on taskapp.project_invitations from anon, authenticated;
revoke insert, update, delete on taskapp.project_members from anon, authenticated;
revoke insert, update, delete on taskapp.projects from anon, authenticated;
revoke insert, update, delete on taskapp.task_assignments from anon, authenticated;
revoke insert, update, delete on taskapp.task_notifications from anon, authenticated;
revoke insert, update, delete on taskapp.task_relations from anon, authenticated;

-- 例外：组员可以直接改自己在组里的昵称（RLS 限定只能改自己那一行）
grant update (nickname) on taskapp.group_members to authenticated;

-- 只供其他函数和触发器内部调用的函数，前端不能直接调用
revoke all on function taskapp.apply_task_raci(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function taskapp.delete_group_now(uuid) from public, anon, authenticated;
revoke all on function taskapp.delete_project_now(uuid) from public, anon, authenticated;
revoke all on function taskapp.finish_group_deletion_if_agreed(uuid) from public, anon, authenticated;
revoke all on function taskapp.finish_leader_request_if_agreed(uuid) from public, anon, authenticated;
revoke all on function taskapp.finish_project_deletion_if_agreed(uuid) from public, anon, authenticated;
revoke all on function taskapp.notify_task(uuid, text, uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function taskapp.notify_task_roles(uuid, text[], text, uuid, text[]) from public, anon, authenticated;
revoke all on function taskapp.recompute_task_schedule(uuid) from public, anon, authenticated;
revoke all on function taskapp.remove_member_now(uuid, uuid) from public, anon, authenticated;
revoke all on function taskapp.remove_project_member_now(uuid, uuid) from public, anon, authenticated;
revoke all on function taskapp.task_relations_after_delete() from public, anon, authenticated;
revoke all on function taskapp.tasks_schedule_cascade() from public, anon, authenticated;
revoke all on function taskapp.tasks_schedule_compute() from public, anon, authenticated;
