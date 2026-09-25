-- 核心表：tasks
-- 只存放矩阵计算、筛选、排序真正需要的字段。任务状态（待办/已错过/已完成）为派生值，不存储。
--
-- owner_id 不设外键指向 auth.users：账号由独立身份项目签发（Third-Party Auth），
-- 本项目的 auth.users 中没有用户记录；auth.uid() 读取的是外部 JWT 的 sub。

create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid(),
  title              text not null,
  description        text not null default '',
  deadline_at        timestamptz,
  importance_level   smallint not null default 0
                     constraint tasks_importance_level_range check (importance_level between 0 and 5),
  recurrence_rule    text,
  recurrence_dtstart timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- 循环开关打开时必须有起始时间；关闭（清空规则）时可保留起始时间
  constraint tasks_recurrence_requires_dtstart
    check (recurrence_rule is null or recurrence_dtstart is not null)
);

comment on column public.tasks.importance_level is '重要性 0-5：0 = 未设置，1-5 为用户设置的档位';
comment on column public.tasks.recurrence_rule is 'RFC 5545 RRULE；非空即为循环任务';

create index tasks_owner_id_idx on public.tasks (owner_id);
create index tasks_owner_deadline_idx on public.tasks (owner_id, deadline_at);

-- updated_at 用于同步冲突解决（Last-Write-Wins）
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
