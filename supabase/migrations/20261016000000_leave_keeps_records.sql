-- 第一个增量迁移：完成记录不被连带删除；成员离开只做标记；关掉循环保留历史。
--
-- 只包含这一次的变化，在已有数据上执行，不删除、不改写任何现有数据：
-- - 新增 4 列，都可以为空，现有的行就是"没离开、没删除、没归入历史"；
-- - 普通任务勾选的唯一索引只算没归入历史的勾选（现有的勾选都满足）；
-- - 改写相关函数（签名不变），新增 project_former_people；
-- - 默认项目的触发器在重新加入（left_at 清空）时也执行。
--
-- 规则：
-- - 离开（踢出、退出、移出项目）：只有未完成任务上的 R、A 挡住；离开时 RACI 全部保留，成员记录只记下 left_at、
--   昵称保留；名单、权限、通知、投票、"和我有关的任务"只算没离开的人；再次加入时恢复原来那条记录和昵称，身份按新人。
-- - 合作组最后一个人不能退出（last_member）；删除只有名字的人只记下 deleted_at，任务上的标注保留。
-- - 关掉循环：当前这一次是任务现在的状态，之前的一律是历史；以后提前完成的、勾过子任务的留在历史里；
--   以前作为普通任务留下的勾选归入历史（archived_at），不删除。

-- 函数体里可能引用后面才改的函数
set check_function_bodies = false;

-- 1. 新增的列 ---------------------------------------------------------------------------------

-- 离开（被踢出或退出）的时间：成员记录不删除，只标记为已离开；昵称保留。
-- 名单、权限、通知、投票、"和我有关的任务"都只算没离开的人。再次加入时恢复这条记录（身份按新人）
alter table taskapp.group_members add column left_at timestamptz;

-- 离开项目（被移出、退出项目或退出小组）的时间：成员记录不删除，只标记为已离开
alter table taskapp.project_members add column left_at timestamptz;

-- 删除的时间：只标记为已删除（从名单和 RACI 的候选里消失），任务上的标注保留并照常显示名字
alter table taskapp.project_contacts add column deleted_at timestamptz;

-- 归入历史的时间：普通任务以前的勾选（例如改成循环之前的），关掉循环时归入历史——
-- 不再算作任务现在的勾选，也不删除。只有普通任务的勾选（occurrence_date 为空）会归入历史
alter table taskapp.task_subtask_checks add column archived_at timestamptz;

-- 2. 索引 -------------------------------------------------------------------------------------

-- 同一个子任务：普通任务只有一个（没归入历史的）勾选，循环任务每一次一个
drop index taskapp.task_subtask_checks_once_key;
create unique index task_subtask_checks_once_key
  on taskapp.task_subtask_checks (subtask_id) where occurrence_date is null and archived_at is null;

-- 3. 函数 -------------------------------------------------------------------------------------

-- 当前用户是不是这个组的成员（security definer：避免 group_members 的 RLS 递归）
create or replace function taskapp.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid() and m.left_at is null
  );
$$;

create or replace function taskapp.group_roster(p_group_id uuid)
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
  where m.group_id = p_group_id and m.left_at is null
    and taskapp.is_group_member(p_group_id)
  order by m.joined_at, m.user_id;
$$;

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
    where m.group_id = p_group_id and lower(u.email) = v_email and m.left_at is null
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
  -- 离开过的人再次加入：恢复他原来那条成员记录（昵称保留），身份和加入时间按新人
  insert into taskapp.group_members (group_id, user_id, role)
  values (
    v_group_id,
    auth.uid(),
    case taskapp.group_kind(v_group_id) when 'cooperative' then 'leader' else 'member' end
  )
  on conflict (group_id, user_id) do update
    set role = excluded.role, joined_at = now(), left_at = null
    where taskapp.group_members.left_at is not null;
  -- 成了组长（合作组）：以前只加入了项目的行不再需要（组长自动在每个项目里）
  if taskapp.group_kind(v_group_id) = 'cooperative' then
    delete from taskapp.project_members pm using taskapp.projects p
    where p.id = pm.project_id and p.group_id = v_group_id and pm.user_id = auth.uid();
  end if;
  delete from taskapp.group_invitations where id = p_invitation_id;
  return v_group_id;
end;
$$;

-- 所有组长都同意（投了同意票）了就删除组
create or replace function taskapp.finish_group_deletion_if_agreed(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from taskapp.group_deletion_requests where group_id = p_group_id)
     and not exists (
       select 1 from taskapp.group_members m
       where m.group_id = p_group_id and m.role = 'leader' and m.left_at is null
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
create or replace function taskapp.request_group_deletion(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from taskapp.group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'leader' and left_at is null
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
create or replace function taskapp.vote_group_deletion(p_group_id uuid, p_agree boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from taskapp.group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'leader' and left_at is null
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

-- 当前用户在这个组里的身份；不是成员时为 null
create or replace function taskapp.my_group_role(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from taskapp.group_members
  where group_id = p_group_id and user_id = auth.uid() and left_at is null;
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
    where m.group_id = v_request.group_id and m.role = 'leader' and m.left_at is null
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
create or replace function taskapp.request_leader_appointment(p_group_id uuid, p_user_id uuid)
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
    where group_id = p_group_id and user_id = p_user_id and role <> 'leader' and left_at is null
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

-- 挡住某人离开组的任务：他在组里未完成（还没标记完成，不含待确认）的任务上的执行人、负责人
create or replace function taskapp.member_task_roles(p_group_id uuid, p_user_id uuid)
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
    and t.group_id = p_group_id and t.deleted_at is null and t.completed_at is null
    and a.user_id = p_user_id and a.role in ('R', 'A')
  order by p.name, t.title, t.id, position(a.role in 'RACI');
$$;

-- 内部：某人离开小组（被踢出或退出）。成员记录不删除，只标记为已离开（同时离开组里的全部项目）；
-- 他在任务上的 RACI 全部保留（离开后不再收到通知）；他的投票作废。
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
  update taskapp.project_members pm set left_at = taskapp.clock_now()
  from taskapp.projects p
  where p.id = pm.project_id and p.group_id = p_group_id and pm.user_id = p_user_id
    and pm.left_at is null;
  delete from taskapp.group_leader_requests
  where group_id = p_group_id and candidate_id = p_user_id;
  delete from taskapp.group_leader_votes v
  using taskapp.group_leader_requests r
  where r.id = v.request_id and r.group_id = p_group_id and v.user_id = p_user_id;
  delete from taskapp.group_deletion_votes where group_id = p_group_id and user_id = p_user_id;
  delete from taskapp.project_deletion_votes v using taskapp.projects p
  where p.id = v.project_id and p.group_id = p_group_id and v.user_id = p_user_id;
  update taskapp.group_members set left_at = taskapp.clock_now()
  where group_id = p_group_id and user_id = p_user_id and left_at is null;

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

-- 身上有没有挡住离开的 R 或 A：只看未完成的任务（还没标记完成；已完成、待确认的不挡；已删除的不算）
create or replace function taskapp.has_ra_in_group(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.task_assignments a
    join taskapp.tasks t on t.id = a.task_id
    where t.group_id = p_group_id and t.deleted_at is null and t.completed_at is null
      and a.user_id = p_user_id and a.role in ('R', 'A')
  );
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
  where group_id = p_group_id and user_id = p_user_id and left_at is null;
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

-- 退出小组：在组里未完成的任务上有执行人或负责人时不能退出；管理组最后一位组长不能退出；
-- 合作组最后一个人也不能退出（要结束就删除组：完成的记录不会因为成员离开而消失）
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
  if v_role = 'leader' and not exists (
    select 1 from taskapp.group_members
    where group_id = p_group_id and role = 'leader' and user_id <> auth.uid() and left_at is null
  ) then
    return case taskapp.group_kind(p_group_id) when 'cooperative' then 'last_member' else 'last_leader' end;
  end if;
  perform taskapp.remove_member_now(p_group_id, auth.uid());
  return 'left';
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

  -- 只检查新加进去的人（这个字母上原来没有他）：已经离开的成员、已删除的只有名字的人原样留着不算错，
  -- 但不能新加进去
  for v_item in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) loop
    if exists (
      select 1 from taskapp.task_assignments a
      where a.task_id = p_task_id and a.role = v_item ->> 'role'
        and (a.user_id = (v_item ->> 'user_id')::uuid or a.contact_id = (v_item ->> 'contact_id')::uuid)
    ) then
      continue;
    end if;
    if v_item ->> 'user_id' is not null
       and not taskapp.is_project_member_user(v_project_id, (v_item ->> 'user_id')::uuid) then
      raise exception 'RACI 里的成员必须是项目成员' using errcode = 'check_violation';
    end if;
    if v_item ->> 'contact_id' is not null and not exists (
      select 1 from taskapp.project_contacts
      where project_id = v_project_id and id = (v_item ->> 'contact_id')::uuid and deleted_at is null
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

-- 新加入组的成员（包括离开后再次加入的）自动进默认项目（组长不用：组长自动在每个项目里）；
-- 以前在默认项目里的那条成员记录恢复，身份按新人
create or replace function taskapp.group_members_join_default_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'member' and new.left_at is null
     and (tg_op = 'INSERT' or old.left_at is not null) then
    insert into taskapp.project_members (project_id, user_id, role)
    select p.id, new.user_id, 'member'
    from taskapp.projects p
    where p.group_id = new.group_id and p.is_default
    on conflict (project_id, user_id) do update
      set role = 'member', joined_at = now(), left_at = null
      where taskapp.project_members.left_at is not null;
  end if;
  return null;
end;
$$;

-- 某人是不是这个项目的成员（组长自动是）
create or replace function taskapp.is_project_member_user(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.projects p
    join taskapp.group_members m on m.group_id = p.group_id and m.user_id = p_user_id
    where p.id = p_project_id and m.role = 'leader' and m.left_at is null
  ) or exists (
    select 1 from taskapp.project_members
    where project_id = p_project_id and user_id = p_user_id and left_at is null
  );
$$;

-- 项目管理员：组长；被任命的管理员；合作组的项目里人人都是管理员
create or replace function taskapp.is_project_admin(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select taskapp.is_group_leader(taskapp.project_group(p_project_id))
    or exists (
      select 1 from taskapp.project_members pm
      where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.left_at is null
        and (pm.role = 'admin' or taskapp.group_kind(taskapp.project_group(p_project_id)) = 'cooperative')
    );
$$;

-- 能看到这个组（组名）：小组成员，或者只加入了组里某个项目的人
create or replace function taskapp.is_group_participant(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select taskapp.is_group_member(p_group_id) or exists (
    select 1 from taskapp.project_members pm join taskapp.projects p on p.id = pm.project_id
    where p.group_id = p_group_id and pm.user_id = auth.uid() and pm.left_at is null
  );
$$;

-- 挡住某人离开项目的任务：他在这个项目未完成（还没标记完成，不含待确认）的任务上的执行人、负责人
create or replace function taskapp.project_member_task_roles(p_project_id uuid, p_user_id uuid)
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
    and t.project_id = p_project_id and t.deleted_at is null and t.completed_at is null
    and a.user_id = p_user_id and a.role in ('R', 'A')
  order by t.title, t.id, position(a.role in 'RACI');
$$;

create or replace function taskapp.has_ra_in_project(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from taskapp.task_assignments a
    join taskapp.tasks t on t.id = a.task_id
    where t.project_id = p_project_id and t.deleted_at is null and t.completed_at is null
      and a.user_id = p_user_id and a.role in ('R', 'A')
  );
$$;

-- 内部：某人离开项目（被移出或退出）。成员记录不删除，只标记为已离开；他在任务上的 RACI 全部保留
create or replace function taskapp.remove_project_member_now(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update taskapp.project_members set left_at = taskapp.clock_now()
  where project_id = p_project_id and user_id = p_user_id and left_at is null;
end;
$$;

-- 内部：全体组长都同意了就删除项目
create or replace function taskapp.finish_project_deletion_if_agreed(p_project_id uuid)
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
       where m.group_id = v_group_id and m.role = 'leader' and m.left_at is null
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
create or replace function taskapp.create_project(p_group_id uuid, p_name text, p_color text, p_tools text[], p_member_ids uuid[])
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
  where m.group_id = p_group_id and m.role = 'member' and m.left_at is null
    and m.user_id = any (coalesce(p_member_ids, '{}'));
  return v_project;
end;
$$;

-- 项目名单：组长（自动在）、管理员、成员。名字：小组成员用本组昵称，只加入了项目的人用 TaskApp 名字
create or replace function taskapp.project_roster(p_project_id uuid)
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
    where m.role = 'leader' and m.left_at is null
    union all
    select pm.user_id,
           case when pm.role = 'admin' or taskapp.group_kind(p.group_id) = 'cooperative'
                then 'admin' else 'member' end,
           exists (select 1 from taskapp.group_members m
                   where m.group_id = p.group_id and m.user_id = pm.user_id and m.left_at is null),
           pm.joined_at
    from taskapp.project_members pm join p on p.id = pm.project_id
    where pm.left_at is null
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

-- 已经离开、但还挂在这个项目的任务上（RACI）的人：任务上照常显示他们的名字
-- （组里的昵称；只加入了项目的人用 TaskApp 名字）
create or replace function taskapp.project_former_people(p_project_id uuid)
returns table (user_id uuid, nickname text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.user_id, coalesce(gm.nickname, u.display_name)
  from taskapp.task_assignments a
  join taskapp.tasks t on t.id = a.task_id
  join taskapp.users u on u.id = a.user_id
  left join taskapp.group_members gm on gm.group_id = t.group_id and gm.user_id = a.user_id
  where t.project_id = p_project_id
    and taskapp.is_project_member(p_project_id)
    and not taskapp.is_project_member_user(p_project_id, a.user_id);
$$;

-- 往项目里加小组成员（项目管理员；直接加入，不需要对方同意）
create or replace function taskapp.add_project_member(p_project_id uuid, p_user_id uuid)
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
    where group_id = taskapp.project_group(p_project_id) and user_id = p_user_id and left_at is null
  ) then
    raise exception '只能直接加小组成员' using errcode = 'check_violation';
  end if;
  if taskapp.is_project_member_user(p_project_id, p_user_id) then
    return 'already_member';
  end if;
  -- 离开过的人：恢复原来那条成员记录，身份按新人
  insert into taskapp.project_members (project_id, user_id, role) values (p_project_id, p_user_id, 'member')
  on conflict (project_id, user_id) do update
    set role = 'member', joined_at = now(), left_at = null
    where taskapp.project_members.left_at is not null;
  return 'added';
end;
$$;

-- 用邮箱往项目里加人：是小组成员就直接加入；不是就发邀请（对方在通知里同意后加入）。
-- 返回 added / invited / already_member / already_invited / self
create or replace function taskapp.invite_to_project(p_project_id uuid, p_email text)
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
  if taskapp.project_is_default(p_project_id) then
    raise exception '默认项目里是全组成员，请邀请进组' using errcode = 'check_violation';
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
    where group_id = taskapp.project_group(p_project_id) and user_id = v_user and left_at is null
  ) then
    insert into taskapp.project_members (project_id, user_id, role) values (p_project_id, v_user, 'member')
  on conflict (project_id, user_id) do update
    set role = 'member', joined_at = now(), left_at = null
    where taskapp.project_members.left_at is not null;
    return 'added';
  end if;
  insert into taskapp.project_invitations (project_id, email, invited_by)
  values (p_project_id, v_email, auth.uid())
  on conflict (project_id, email) do nothing;
  return case when found then 'invited' else 'already_invited' end;
end;
$$;

create or replace function taskapp.accept_project_invitation(p_invitation_id uuid)
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
    values (v_project_id, auth.uid(), 'member')
  on conflict (project_id, user_id) do update
    set role = 'member', joined_at = now(), left_at = null
    where taskapp.project_members.left_at is not null;
  end if;
  delete from taskapp.project_invitations where id = p_invitation_id;
  return v_project_id;
end;
$$;

-- 任命 / 撤销项目管理员：只有组长；合作组里人人都是管理员，不需要任命
create or replace function taskapp.set_project_member_role(p_project_id uuid, p_user_id uuid, p_role text)
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
  where project_id = p_project_id and user_id = p_user_id and left_at is null;
  if not found then
    raise exception '他不是这个项目的成员（组长不用任命）' using errcode = 'check_violation';
  end if;
end;
$$;

-- 把人移出项目：项目管理员能移出成员，组长还能移出管理员；组长不能被移出。
-- 他在未完成的任务上有执行人或负责人时不执行（blocked）
create or replace function taskapp.remove_project_member(p_project_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
  v_effective text;
begin
  if taskapp.project_is_default(p_project_id) then
    raise exception '全组成员都在默认项目里' using errcode = 'check_violation';
  end if;
  select role into v_target_role from taskapp.project_members
  where project_id = p_project_id and user_id = p_user_id and left_at is null;
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

-- 退出项目：组长不能退出项目；在未完成的任务上有执行人或负责人时不能退出
create or replace function taskapp.leave_project(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if taskapp.project_is_default(p_project_id) then
    raise exception '全组成员都在默认项目里，退出小组才会离开' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from taskapp.project_members
    where project_id = p_project_id and user_id = auth.uid() and left_at is null
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

create or replace function taskapp.remove_project_contact(p_contact_id uuid)
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
  -- 只标记为已删除：从名单和 RACI 的候选里消失，任务上的标注保留并照常显示名字
  update taskapp.project_contacts set deleted_at = taskapp.clock_now()
  where id = p_contact_id and deleted_at is null;
end;
$$;

-- 勾选 / 取消勾选一个子任务。循环任务要给出是哪一次（p_occurrence_date），普通任务为空。
-- 谁能勾：个人任务是自己；开了任务分配的项目里是父任务的执行人；没开的项目里是项目成员。不发通知。
create or replace function taskapp.set_subtask_checked(p_subtask_id uuid, p_occurrence_date date, p_checked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subtask taskapp.task_subtasks;
  v_task taskapp.tasks;
begin
  select * into v_subtask from taskapp.task_subtasks where id = p_subtask_id;
  select * into v_task from taskapp.tasks where id = v_subtask.task_id;
  if v_task.id is null or v_task.deleted_at is not null then
    raise exception '任务不存在' using errcode = 'no_data_found';
  end if;
  if not (
    (v_task.group_id is null and v_task.owner_id = auth.uid())
    or (v_task.project_id is not null and (
      case when taskapp.project_has_tool(v_task.project_id, 'assignment')
           then taskapp.has_task_role(v_task.id, 'R')
           else taskapp.is_project_member(v_task.project_id) end))
  ) then
    raise exception '没有权限勾选这个子任务' using errcode = 'insufficient_privilege';
  end if;
  if (v_task.recurrence_rule is null) <> (p_occurrence_date is null) then
    raise exception '循环任务的子任务按每一次勾选，普通任务不分次' using errcode = 'check_violation';
  end if;
  if not taskapp.subtask_applies(v_subtask, p_occurrence_date) then
    raise exception '这一次没有这个子任务' using errcode = 'check_violation';
  end if;

  if p_checked then
    insert into taskapp.task_subtask_checks (subtask_id, occurrence_date, checked_by)
    values (p_subtask_id, p_occurrence_date, auth.uid())
    on conflict do nothing;
  else
    delete from taskapp.task_subtask_checks
    where subtask_id = p_subtask_id and occurrence_date is not distinct from p_occurrence_date
      and archived_at is null;
  end if;
end;
$$;

-- 关掉循环（循环任务没有结束条件，这是唯一的结束方式）。当前这一次是任务现在的状态，之前的一律是历史：
-- - 当前这一次（p_current_date：按用户本地日期算出的、最早一个还没完成、日期还没过去的那一次）变成普通任务，
--   它的子任务勾选成为普通任务的勾选；
-- - 以前作为普通任务留下的勾选（例如改成循环之前的）归入历史：不再算作任务现在的勾选，也不删除；
-- - 以后的各次：提前勾了完成的、勾过子任务的留在历史里（没完成的显示为没完成和它的进度）；
--   既没完成、也没勾过子任务的才消失；
-- - 过去各次的历史记录保留，只是不再增加。完成的记录不会被系统连带删除。
create or replace function taskapp.stop_recurrence(p_task_id uuid, p_current_date date)
returns taskapp.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task taskapp.tasks;
begin
  if not taskapp.can_edit_task(p_task_id) then
    raise exception '没有编辑这个任务的权限' using errcode = 'insufficient_privilege';
  end if;
  if p_current_date is null then
    raise exception '缺少当前这一次的日期' using errcode = 'check_violation';
  end if;
  select * into v_task from taskapp.tasks where id = p_task_id;
  if v_task.recurrence_rule is null then
    return v_task;
  end if;

  -- 以后勾过子任务的那几次：还没有记录的补一条（没完成），留在历史里
  insert into taskapp.recurrence_occurrences (task_id, occurrence_date, status)
  select distinct p_task_id, c.occurrence_date, 'missed'::taskapp.occurrence_status
  from taskapp.task_subtask_checks c
  join taskapp.task_subtasks s on s.id = c.subtask_id
  where s.task_id = p_task_id and c.occurrence_date > p_current_date
  on conflict (task_id, occurrence_date) do nothing;
  update taskapp.recurrence_occurrences
  set status = 'missed'
  where task_id = p_task_id and occurrence_date > p_current_date and status = 'pending';
  -- 当前这一次变成任务本身；以后既没完成、也没勾过子任务的消失
  delete from taskapp.recurrence_occurrences o
  where o.task_id = p_task_id
    and (
      o.occurrence_date = p_current_date
      or (
        o.occurrence_date > p_current_date and o.status <> 'completed'
        and not exists (
          select 1 from taskapp.task_subtask_checks c
          join taskapp.task_subtasks s on s.id = c.subtask_id
          where s.task_id = p_task_id and c.occurrence_date = o.occurrence_date
        )
      )
    );

  -- 子任务的勾选：以前作为普通任务的归入历史；当前这一次的成为普通任务的勾选
  update taskapp.task_subtask_checks c
  set archived_at = taskapp.clock_now()
  from taskapp.task_subtasks s
  where s.id = c.subtask_id and s.task_id = p_task_id
    and c.occurrence_date is null and c.archived_at is null;
  update taskapp.task_subtask_checks c
  set occurrence_date = null
  from taskapp.task_subtasks s
  where s.id = c.subtask_id and s.task_id = p_task_id and c.occurrence_date = p_current_date;

  update taskapp.tasks
  set recurrence_rule = null,
      recurrence_start_on = null,
      deadline_on = p_current_date,
      completed_at = null
  where id = p_task_id
  returning * into v_task;
  return v_task;
end;
$$;

-- 4. 触发器 -----------------------------------------------------------------------------------

-- 加入组（包括离开后再次加入）时自动加入默认项目
drop trigger group_members_join_default_project on taskapp.group_members;
create trigger group_members_join_default_project
  after insert or update of left_at on taskapp.group_members
  for each row execute function taskapp.group_members_join_default_project();

