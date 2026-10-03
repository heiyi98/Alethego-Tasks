-- 把 TaskApp 从 Mindo 项目里一次删干净（迁到 TaskApp 自己的 Supabase 项目之后执行）。
--
-- TaskApp 的全部表（包括组、组里的项目、工具箱、RACI、通知、任务关系相关的表）、视图、函数、触发器、类型（occurrence_status）、
-- RLS 策略和默认授权都只在 taskapp 这个 schema 里，
-- supabase/migrations 没有在 public、auth 或其他 schema 里建过任何东西，所以删掉这个 schema 就删干净了，
-- 不碰 Mindo 自己的任何东西。数据不保留。
--
-- 执行后还要在控制台的 Data API 设置里把 taskapp 从 Exposed schemas 去掉（见 docs/07-迁库说明.md）。

drop schema if exists taskapp cascade;
