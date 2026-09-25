-- 分类：与任务多对多。删除分类只级联删除关联行，任务本体不受影响。
-- 任务是软删除，其关联行与实例记录随任务保留，不会被级联删除。

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default public.current_owner_id(),
  name       text not null,
  color      text not null
             constraint categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

-- 颜色在同一用户的分类集合内排他（不区分大小写）
create unique index categories_owner_color_key on public.categories (owner_id, lower(color));

create table public.task_categories (
  task_id     uuid not null references public.tasks (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (task_id, category_id)
);

-- 主键已覆盖按 task_id 查询；按分类筛选任务需要反向索引
create index task_categories_category_id_idx on public.task_categories (category_id);
