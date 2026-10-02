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
