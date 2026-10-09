-- 把 TaskApp 从当前 Supabase 项目里一次删干净。
--
-- TaskApp 的全部表、函数、触发器、类型（occurrence_status）、RLS 策略和默认授权都只在 taskapp 这个 schema 里，
-- 初始结构和之后的迁移都没有在 public、auth 或其他 schema 里建过任何东西，所以删掉这个 schema 就删干净了，
-- 不碰同一项目里其他产品的任何东西。数据不保留。
--
-- 只在两种情况下使用（见 docs/07-迁库说明.md）：
--   1. 迁到 TaskApp 自己的 Supabase 项目之后，从 Mindo 里删掉 TaskApp；
--   2. 上线前改了初始结构之后替换测试库（数据全部清空）。
-- 上线后不允许清空数据或删库重建：改库一律写新的迁移。

drop schema if exists taskapp cascade;
