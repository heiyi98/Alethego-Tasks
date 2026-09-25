# Alethego Tasks

内置「时间管理矩阵」的任务管理工具。产品与技术设计见 [`docs/`](./docs)（00–05）。

## 目录结构

```
packages/core/   领域层：纯 TypeScript，无框架依赖（Web / Mobile 共享）
packages/data/   数据层：仓储接口、Supabase 远程实现、本地存储接口
apps/web/        Next.js：任务列表、快速添加、任务详情/编辑（直接读写 Supabase）
supabase/        数据库迁移（tasks、categories、task_categories、recurrence_occurrences + RLS）
```

### packages/core

| 模块                           | 职责                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `urgency/` UrgencyCalculator   | 紧迫度：斐波那契 14 档 + 扩展向量；无截止时间归最大档；逾期不封顶                             |
| `quadrant/` QuadrantClassifier | 由（紧迫度 × 重要性）派生象限与矩阵展示判定；只接收 `MatrixCandidate`，不感知循环任务         |
| `recurrence/` RecurrenceEngine | 基于 RRULE 计算下一实例、代表实例（日期未过去的最早未完成实例）、归档判定（pending → missed） |
| `list/`                        | 列表默认排序：截止时间从近到远，无截止时间排最后（循环任务按代表实例）                        |
| `representative/`              | 把普通任务 / 循环任务收敛为同一种「一个代表」，再交给矩阵                                     |
| `time/`                        | 按用户时区计算日历日，不依赖运行环境的系统时区                                                |

约定：重要性 0–5（0 = 未设置），3–5 算重要（`IMPORTANT_THRESHOLD`）；紧迫度按用户时区的日历日差分档；
逾期任务在矩阵上保留 3 天（`OVERDUE_MATRIX_GRACE_DAYS`）。

### 数据约定

- **暂无登录**：所有数据归属固定的 `LOCAL_OWNER_ID`（`packages/data/src/owner.ts`，与数据库函数
  `current_owner_id()` 一致），RLS 临时对 anon 开放。接入账号体系时改函数体、去掉策略中的 anon 即可。
- **快速添加**：只需标题即可创建任务，其余字段之后通过 `update` 补充；空白标题会被拒绝。
- **软删除**：删除任务只写入 `deleted_at`，数据库不开放物理删除；分类关联与循环实例记录保留，可 `restore`。

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

### 运行 Web

```bash
cp apps/web/.env.example apps/web/.env.local   # 填入 Supabase URL 与 anon key
pnpm dev
```

页面：

- `/` 任务列表：顶部输入框回车快速添加；状态筛选（待办 / 已错过 / 已完成 / 全部，默认待办）与
  分类多选筛选（命中其一即显示）可组合，筛选条件保存在 URL 中；勾选即完成；可就地新建分类
- `/tasks/[id]` 详情：编辑标题、描述、截止时间、重要性 0–5、分类多选、完成状态；删除为软删除

### 端到端测试

驱动真实页面读写 Supabase，需要先配置好 `.env.local` 并应用迁移：

```bash
pnpm --filter @alethego/web test:e2e
```

## 暂未实现

账号认证（Third-Party Auth 接入待定，目前为固定 owner）、矩阵视图、循环任务的编辑界面、离线同步（SyncEngine / IndexedDB / SQLite）、
子任务、通讯录 / 地图 / 日历集成。
