# Alethego Tasks

内置「时间管理矩阵」的任务管理工具。产品与技术设计见 [`docs/`](./docs)（00–05）。

## 目录结构

```
packages/core/   领域层：纯 TypeScript，无框架依赖（Web / Mobile 共享）
packages/data/   数据层：仓储接口、Supabase 远程实现、本地存储接口
apps/web/        Next.js（目前只有骨架）
supabase/        数据库迁移（tasks、categories、task_categories、recurrence_occurrences + RLS）
```

### packages/core

| 模块                           | 职责                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `urgency/` UrgencyCalculator   | 紧迫度：斐波那契 14 档 + 扩展向量；无截止时间归最大档；逾期不封顶                             |
| `quadrant/` QuadrantClassifier | 由（紧迫度 × 重要性）派生象限与矩阵展示判定；只接收 `MatrixCandidate`，不感知循环任务         |
| `recurrence/` RecurrenceEngine | 基于 RRULE 计算下一实例、代表实例（日期未过去的最早未完成实例）、归档判定（pending → missed） |
| `representative/`              | 把普通任务 / 循环任务收敛为同一种「一个代表」，再交给矩阵                                     |
| `time/`                        | 按用户时区计算日历日，不依赖运行环境的系统时区                                                |

约定：重要性 0–5（0 = 未设置），3–5 算重要（`IMPORTANT_THRESHOLD`）；紧迫度按用户时区的日历日差分档；
逾期任务在矩阵上保留 3 天（`OVERDUE_MATRIX_GRACE_DAYS`）。

## 常用命令

需要 Node ≥ 22 与 pnpm 10。

```bash
pnpm install
pnpm test        # 全部单元测试
pnpm typecheck
pnpm build
pnpm dev         # 启动 apps/web
```

本地数据库（需安装 Supabase CLI）：

```bash
supabase start
supabase db reset   # 应用 supabase/migrations
```

## 暂未实现

账号认证（Third-Party Auth 接入待定）、UI 页面、离线同步（SyncEngine / IndexedDB / SQLite）、
子任务、通讯录 / 地图 / 日历集成。
