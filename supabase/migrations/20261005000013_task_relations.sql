-- 任务关系（工具箱里的"任务关系"生效）。
--
-- 哪里生效：组里开了"任务关系"的项目里的任务；个人任务只要挂了至少一个开了"任务关系"的分类。
-- 循环任务不参与：没有开始 / 结束的关系，也不能被选为关系对象。
--
-- 每个这样的任务有两行逻辑：
--   开始：固定日期（tasks.start_on），或者"于〔某任务〕的〔开始 / 结束〕"（task_relations，side = 'start'）
--   结束：固定日期（就是截止时间 tasks.deadline_at），或者"于〔某任务〕的〔开始 / 结束〕"（side = 'end'），
--         或者"开始后 N 天"（tasks.end_after_days）
-- 一行可以挂多个关系，取最晚的日期；每个关系有偏移（offset_days，正数 = 后 N 天，负数 = 前 N 天）。
-- 填了关系的那一行由数据库算出日期（触发器 tasks_schedule_compute），算出的结束日期写进截止时间
-- （当天最后一刻，按 date_zone 时区），矩阵和紧迫度照常使用。
-- 前置任务的日期变了，依赖它的任务自动重新计算（触发器 tasks_schedule_cascade，逐层往下）；
-- 截止时间因此变了的任务，在开了任务分配的项目里按现有规则发"修改了截止时间"的通知，操作者是改动前置任务的人。
-- 不允许形成循环（A 等 B、B 又等 A）：保存时拒绝。
--
-- 日期的含义：某任务的"开始日期"是 start_on（没有开始的任务按结束日期算，即里程碑）；
-- "结束日期"是截止时间所在的日期，按依赖它的那条任务的时区（date_zone，设定关系的人的时区）换算。

-- 1. 任务上的字段 -----------------------------------------------------------------------------

alter table taskapp.tasks
  add column start_on date,
  add column end_after_days integer
    constraint tasks_end_after_days_range check (end_after_days between 0 and 3650),
  add column date_zone text;

-- 2. 关系 --------------------------------------------------------------------------------------

create table taskapp.task_relations (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references taskapp.tasks (id) on delete cascade,
  side           text not null constraint task_relations_side_check check (side in ('start', 'end')),
  predecessor_id uuid not null references taskapp.tasks (id) on delete cascade,
  anchor         text not null constraint task_relations_anchor_check check (anchor in ('start', 'end')),
  offset_days    integer not null default 0
                 constraint task_relations_offset_range check (offset_days between -3650 and 3650),
  created_at     timestamptz not null default now(),
  constraint task_relations_not_self check (task_id <> predecessor_id),
  unique (task_id, side, predecessor_id, anchor)
);

create index task_relations_predecessor_idx on taskapp.task_relations (predecessor_id);

alter table taskapp.task_relations enable row level security;

create policy "task_relations_select" on taskapp.task_relations
  for select to authenticated using (taskapp.can_access_task(task_id));

revoke insert, update, delete on taskapp.task_relations from anon, authenticated;
grant select on taskapp.task_relations to authenticated;

-- 3. 判断与日期换算 ----------------------------------------------------------------------------

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

-- 4. 计算与级联 --------------------------------------------------------------------------------

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

create trigger tasks_schedule_compute
  before update on taskapp.tasks
  for each row execute function taskapp.tasks_schedule_compute();

-- 重新计算某条任务（"碰一下"它，由上面的触发器算出新日期）
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

create trigger task_relations_after_delete
  after delete on taskapp.task_relations
  for each row execute function taskapp.task_relations_after_delete();

-- 5. 内容只有能编辑任务的人能改：开始日期和"开始后 N 天"也算内容 ------------------------------

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

-- 6. 设定开始和结束 ----------------------------------------------------------------------------

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
create function taskapp.set_task_schedule(
  p_task_id uuid,
  p_start_on date,
  p_start_relations jsonb,
  p_end_after_days integer,
  p_end_relations jsonb,
  p_date_zone text
)
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

-- 7. 权限 --------------------------------------------------------------------------------------

revoke execute on function
  taskapp.tasks_schedule_compute(),
  taskapp.tasks_schedule_cascade(),
  taskapp.task_relations_after_delete(),
  taskapp.recompute_task_schedule(uuid)
from public, anon, authenticated;

grant execute on function
  taskapp.task_has_relations(uuid),
  taskapp.task_anchor_date(uuid, text, text),
  taskapp.end_of_local_day(date, text),
  taskapp.relation_side_date(uuid, text, text),
  taskapp.relation_creates_cycle(uuid, uuid),
  taskapp.can_relate_tasks(uuid, uuid),
  taskapp.set_task_schedule(uuid, date, jsonb, integer, jsonb, text)
to authenticated;
