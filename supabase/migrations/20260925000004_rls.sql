-- 行级安全：所有数据按 owner_id = auth.uid() 隔离。
-- 使用 (select auth.uid()) 让函数每条语句只求值一次。

alter table public.tasks enable row level security;
alter table public.categories enable row level security;
alter table public.task_categories enable row level security;
alter table public.recurrence_occurrences enable row level security;

-- tasks ------------------------------------------------------------------

create policy "tasks_select_own" on public.tasks
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "tasks_insert_own" on public.tasks
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "tasks_update_own" on public.tasks
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "tasks_delete_own" on public.tasks
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- categories -------------------------------------------------------------

create policy "categories_select_own" on public.categories
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "categories_insert_own" on public.categories
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "categories_update_own" on public.categories
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "categories_delete_own" on public.categories
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- task_categories --------------------------------------------------------
-- 任务和分类都必须属于当前用户，防止把自己的任务挂到别人的分类上（或反之）。

create function public.owns_task(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.owner_id = (select auth.uid())
  );
$$;

create function public.owns_category(p_category_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.owner_id = (select auth.uid())
  );
$$;

create policy "task_categories_select_own" on public.task_categories
  for select to authenticated
  using (public.owns_task(task_id) and public.owns_category(category_id));

create policy "task_categories_insert_own" on public.task_categories
  for insert to authenticated
  with check (public.owns_task(task_id) and public.owns_category(category_id));

create policy "task_categories_delete_own" on public.task_categories
  for delete to authenticated
  using (public.owns_task(task_id) and public.owns_category(category_id));

-- 关联行只有增删，没有有意义的更新，因此不开放 update

-- recurrence_occurrences -------------------------------------------------

create policy "recurrence_occurrences_select_own" on public.recurrence_occurrences
  for select to authenticated
  using (public.owns_task(task_id));

create policy "recurrence_occurrences_insert_own" on public.recurrence_occurrences
  for insert to authenticated
  with check (public.owns_task(task_id));

create policy "recurrence_occurrences_update_own" on public.recurrence_occurrences
  for update to authenticated
  using (public.owns_task(task_id))
  with check (public.owns_task(task_id));

create policy "recurrence_occurrences_delete_own" on public.recurrence_occurrences
  for delete to authenticated
  using (public.owns_task(task_id));
