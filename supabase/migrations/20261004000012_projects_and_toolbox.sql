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
