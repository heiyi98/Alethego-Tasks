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
