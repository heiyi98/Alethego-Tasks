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
