-- 核心表：tasks
-- 只存放矩阵计算、筛选、排序真正需要的字段。任务状态（待办/已错过/已完成）为派生值，不存储。
--
-- owner_id 不设外键指向 auth.users：账号由独立身份项目签发（Third-Party Auth），
-- 本项目的 auth.users 中没有用户记录。未登录阶段取固定值，见 current_owner_id()。
--
-- 删除为软删除（deleted_at），不物理删除。

create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default public.current_owner_id(),
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

comment on column public.tasks.importance_level is '重要性 0-5：0 = 未设置，1-5 为用户设置的档位';
comment on column public.tasks.recurrence_rule is 'RFC 5545 RRULE；非空即为循环任务';

-- 列表默认排序：截止时间从近到远，无截止时间排最后；只索引未删除的任务
create index tasks_owner_deadline_idx on public.tasks (owner_id, deadline_at asc nulls last)
  where deleted_at is null;

-- updated_at 用于同步冲突解决（Last-Write-Wins）；软删除同样会刷新它，删除标记可随同步传播
create function public.set_updated_at()
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
  before update on public.tasks
  for each row execute function public.set_updated_at();
