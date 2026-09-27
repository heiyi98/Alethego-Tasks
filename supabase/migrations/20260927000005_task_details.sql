-- 任务详情扩展表：地点（一对一）、人物（一对多）。
-- 按《04-数据模型文档》字段扩展原则：需要对接外部标准 API 的字段用独立表，结构对齐外部 API
-- （place_id ↔ 地图 API，contact_id ↔ 系统通讯录）。目前只编辑本地自由文本，外部字段先留空。
-- tasks 表不感知这两张表；详情页由 TaskDetailAggregator 统一拼装。
-- 任务是软删除，扩展数据随任务保留；只有任务被物理删除时才级联删除。

-- 地点：一个任务至多一个地点（task_id 即主键）
create table taskapp.task_locations (
  task_id    uuid primary key references taskapp.tasks (id) on delete cascade,
  name       text not null default '',
  address    text not null default '',
  -- 预留：对接地图 API 时使用
  place_id   text,
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 没有任何内容的地点不应存在（清空地点 = 删除这一行）
  constraint task_locations_not_empty
    check (btrim(name) <> '' or btrim(address) <> '' or place_id is not null),
  constraint task_locations_coordinates
    check (
      (lat is null and lng is null)
      or (lat between -90 and 90 and lng between -180 and 180)
    )
);

create trigger task_locations_set_updated_at
  before update on taskapp.task_locations
  for each row execute function taskapp.set_updated_at();

-- 人物：一个任务可关联多个人
create table taskapp.task_people (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references taskapp.tasks (id) on delete cascade,
  name       text not null
             constraint task_people_name_not_blank check (btrim(name) <> ''),
  relation   text not null default '',
  -- 预留：对接系统通讯录时使用
  contact_id text,
  created_at timestamptz not null default now()
);

create index task_people_task_id_idx on taskapp.task_people (task_id);

-- RLS：归属跟随任务（owns_task 见 20260925000004_rls.sql）
alter table taskapp.task_locations enable row level security;
alter table taskapp.task_people enable row level security;

create policy "task_locations_select_own" on taskapp.task_locations
  for select to anon, authenticated using (taskapp.owns_task(task_id));
create policy "task_locations_insert_own" on taskapp.task_locations
  for insert to anon, authenticated with check (taskapp.owns_task(task_id));
create policy "task_locations_update_own" on taskapp.task_locations
  for update to anon, authenticated
  using (taskapp.owns_task(task_id)) with check (taskapp.owns_task(task_id));
create policy "task_locations_delete_own" on taskapp.task_locations
  for delete to anon, authenticated using (taskapp.owns_task(task_id));

create policy "task_people_select_own" on taskapp.task_people
  for select to anon, authenticated using (taskapp.owns_task(task_id));
create policy "task_people_insert_own" on taskapp.task_people
  for insert to anon, authenticated with check (taskapp.owns_task(task_id));
create policy "task_people_update_own" on taskapp.task_people
  for update to anon, authenticated
  using (taskapp.owns_task(task_id)) with check (taskapp.owns_task(task_id));
create policy "task_people_delete_own" on taskapp.task_people
  for delete to anon, authenticated using (taskapp.owns_task(task_id));

-- 显式授权（不依赖之前的 default privileges 是否由同一角色设置）
grant select, insert, update, delete on taskapp.task_locations, taskapp.task_people
  to anon, authenticated, service_role;
