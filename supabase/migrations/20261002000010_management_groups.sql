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
