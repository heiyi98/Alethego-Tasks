-- 任务标星：只是书签，不影响矩阵位置、排序或任何其他规则。
-- 只新增一列（有默认值），不改动已有字段与约束；已有任务均为未标星。
alter table taskapp.tasks
  add column is_starred boolean not null default false;

comment on column taskapp.tasks.is_starred is '标星（书签），默认 false';
