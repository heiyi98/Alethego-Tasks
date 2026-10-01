-- 只用于本地端到端测试，绝不要在真实项目上执行。
-- 把 taskapp.clock_now() 换成"有设定时取设定的时间，否则 now()"，用来测试删除组投票的一周超时。
set client_min_messages = warning;
create table if not exists taskapp.test_clock (
  id int primary key default 1 check (id = 1),
  fixed_at timestamptz
);
revoke all on taskapp.test_clock from anon, authenticated;

create or replace function taskapp.clock_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce((select fixed_at from taskapp.test_clock where id = 1), now());
$$;

delete from taskapp.test_clock;
