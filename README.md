# Alethego Tasks

内置「时间管理矩阵」的任务管理工具。产品与技术设计见 [`docs/`](./docs)（00–05）。

## 目录结构

```
packages/core/   领域层：纯 TypeScript，无框架依赖（Web / Mobile 共享）
packages/data/   数据层：仓储接口、Supabase 远程实现、本地存储接口
apps/web/        Next.js：任务列表、快速添加、展开面板新建/编辑、矩阵（直接读写 Supabase）
supabase/        数据库迁移（taskapp schema：tasks、categories、task_categories、recurrence_occurrences、
                 task_locations、task_people + RLS）
```

### packages/core

| 模块                           | 职责                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `urgency/` UrgencyCalculator   | 紧迫度：斐波那契 14 档 + 扩展向量；无截止时间归最大档；逾期不封顶                              |
| `quadrant/` QuadrantClassifier | 由（紧迫度 × 重要性）派生象限与矩阵展示判定；只接收 `MatrixCandidate`，不感知循环任务          |
| `recurrence/` RecurrenceEngine | 基于 RRULE 计算下一实例、代表实例（日期未过去的最早未完成实例）、归档判定（pending → missed）  |
| `list/`                        | 列表默认排序：截止时间从近到远，无截止时间排最后（循环任务按代表实例）                         |
| `matrix/`                      | 矩阵布局：紧迫度列 × 重要性行的格子、格内散布避让、象限分组；只输出相对坐标，Web / Mobile 共用 |
| `representative/`              | 把普通任务 / 循环任务收敛为同一种「一个代表」，再交给矩阵                                      |
| `time/`                        | 按用户时区计算日历日，不依赖运行环境的系统时区                                                 |

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

业务表全部位于独立的 **`taskapp` schema**（不使用 `public`）。在 Supabase 上部署时，除了执行迁移，
还需要在控制台 **Project Settings → API → Exposed schemas** 中加入 `taskapp`，前端才能访问。

### 运行 Web

```bash
cp apps/web/.env.example apps/web/.env.local   # 填入 Supabase URL 与 anon key
pnpm dev
```

页面（左侧菜单 + 右侧内容，配色为 Apple 系统色）：

- 左侧菜单「总览」：`/list/all`、`/list/todo`（默认）、`/list/completed`、`/list/missed`，
  跨所有分类显示对应状态的任务，页面内用分类标签（多选，命中其一即显示）再筛选
- 左侧菜单「分类」：`/category/[id]`，只显示该分类的任务，页面内用状态标签（全部 / 未完成 / 已完成 / 已错过）再筛选；
  菜单底部可新建分类；每个分类旁的铅笔图标可编辑名称、描述、颜色（同一用户的分类颜色不重复，选到已用颜色时立即提示），
  也可删除分类（确认一次；只解除与任务的关联，任务本身保留）。分类描述显示在分类页标题下方
- 两个区块共用同一份数据与同一套筛选逻辑（`buildTaskList(状态, 分类)`），筛选条件保存在 URL 中；勾选即完成
- 快速添加：标题输入框下方一行选项（重要性，默认 0；截止日期，只选日期，默认无），回车创建；
  分类页、或总览页只点亮一个分类标签时，新任务自动归入该分类。最右侧的三角展开完整的新建面板
- 任务面板（新建与编辑共用同一个组件）：标题、描述、截止日期、重要性、分类、重复规则、地点、人物（多个），
  字段以图标为标签（带 aria-label 与悬停提示）。同一时间只展开一个面板；手机上为底部抽屉
  - 新建：对勾创建并收起；叉放弃（已填写内容时确认一次）；收起不丢草稿
  - 编辑：列表中点击任务在原地展开，矩阵上点击任务弹出面板（不跳转）；改动自动保存，没有保存 / 还原按钮
  - 收起方式：再点三角、点面板外、桌面按 Esc、手机下滑或点背景
  - 删除任务、删除人物、清空描述不弹确认框，之后几秒内的提示条可一键撤销（任务用软删除 + `restore`）
- `/matrix` 时间管理矩阵（菜单底部入口）：X = 紧迫度（越靠右越紧急）；Y = 重要性 0–5 对应六个等宽区间
  [0,1)…[5,6)，下三上三，刻度画在区间边界上；每个任务显示为「分类色标 + 标题」标签，
  同一重要性区间内的标签互不重叠（必要时移到旁边并用引线指回所属列），逾期 3 天内贴右侧边界并标注天数；
  分类多选点亮筛选；下方为按象限分组的列表；点击任务弹出编辑面板
- 「重复」开关打开后可设置重复规则（每 N 天 / 周几 / 每月几号或最后一天 / 每年，可设结束次数或日期），
  截止日期与完成状态改由规则和每次实例决定
- `/tasks/[id]/history` 循环任务的历史记录（从面板中的时钟图标进入）：每次实例的完成 / 未完成，可手动修改；关闭循环后记录保留

循环任务在列表中的勾选框完成的是「当前这一次」实例（不写任务本身的 `completed_at`），勾选后顺延到下一次；
实例记录的生成与"未完成"归档在读取任务时顺带完成（`syncOccurrences`）。

地点 / 人物存放在独立的扩展表中（`task_locations` 一对一、`task_people` 一对多），`tasks` 表不感知它们，
任务面板通过 `TaskDetailAggregator`（`loadTaskDetail` / `saveTaskExtensions`）统一读写。目前只编辑本地自由文本，
表中已预留 `place_id` / `lat` / `lng` 与 `contact_id`，供以后对接地图与通讯录。

### 端到端测试

驱动真实页面读写 Supabase，需要先配置好 `.env.local` 并应用迁移：

```bash
pnpm --filter @alethego/web test:e2e
```

表单与格式化等不依赖浏览器的逻辑另有单元测试（`apps/web/src/lib/*.test.ts`，随 `pnpm test` 运行）。

## 暂未实现

账号认证（Third-Party Auth 接入待定，目前为固定 owner）、离线同步（SyncEngine / IndexedDB / SQLite）、
子任务、通讯录 / 地图 / 日历集成。
