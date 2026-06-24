# Tasks

## 阶段一：数据模型与共享类型（地基，其他都依赖它）

- [x] Task 1: 扩展 DB schema 与内联迁移
  - [x] 1.1: 在 `packages/db/src/schema.ts` 的 `interactions` 表 `kind` 枚举增加 `"coin"`；`item_preferences` 表增加 `coined`（boolean，默认 false）与 `coinedAt`（text，nullable）列
  - [x] 1.2: 在 `packages/db/src/schema.ts` 新增 `favoriteFolders` 表（id / name / createdAt）与 `favorites` 表（id / folderId / itemId / createdAt，folderId+itemId 唯一索引，folderId 外键 onDelete cascade）
  - [x] 1.3: 在 `packages/db/src/index.ts` 的 `migrate()` 中：`interactions` 建表 SQL 的 kind 注释保持兼容（TEXT 不加 CHECK）；新增 `favorite_folders`、`favorites` 建表；用 `ensureColumn` 给 `item_preferences` 加 `coined` 与 `coined_at` 列；新增相关索引
  - [x] 1.4: 运行 `corepack pnpm typecheck` 确认 db 包通过

- [x] Task 2: 扩展 shared 类型
  - [x] 2.1: 在 `packages/shared/src/index.ts` 的 `InteractionKind` 增加 `"coin"`；新增 `FavoriteFolder` 与 `FavoriteEntry` 类型；`Reaction` 保持不变
  - [x] 2.2: 运行 `corepack pnpm typecheck` 确认 shared 包通过

## 阶段二：后端 API 与推荐算法（可并行于阶段一之后）

- [x] Task 3: 推荐算法重写（`packages/recommendation/src/index.ts`）
  - [x] 3.1: 重写 `interactionWeight`：按 kind 应用不同权重（coin=4, like=2, finish=1.5, watch=0.15, dislike=-3），并引入时间衰减 `exp(-ageDays/45)`（ageDays 由 `interactions.created_at` 计算）
  - [x] 3.2: `scoreCandidate` 中 creator/category/tag 亲和度使用新权重；`finish` 交互纳入 creator/category 亲和度计算
  - [x] 3.3: 新增多样性重排函数：对排序后结果，若同 creator 连续出现超过 2 条或在 top N 中占比过高，施加递减惩罚并重排
  - [x] 3.4: 运行 `corepack pnpm typecheck` 确认 recommendation 包通过

- [ ] Task 4: 投币 API（`apps/api/src/index.ts`）
  - [x] 4.1: 新增 `PUT /items/:id/coin` 端点：toggle `item_preferences.coined`，更新 `coined_at`；投币时插入 `coin` 交互（item / creator / category 三级，value=1）；取消投币时不删除历史交互（保留用于推荐）
  - [x] 4.2: `GET /items/:id` 详情返回新增 `coined`（boolean）与 `coinedAt` 字段
  - [x] 4.3: `GET /me/activity` 新增 `recentCoins` 列表（按 `coined_at` 倒序）与 `stats.coins` 计数

- [ ] Task 5: 收藏 API（`apps/api/src/index.ts`）
  - [x] 5.1: 新增 `GET /me/favorites` 返回所有收藏夹（含 itemCount 与 updatedAt）
  - [x] 5.2: 新增 `POST /me/favorites/folders`（body: name）创建收藏夹；`DELETE /me/favorites/folders/:id` 删除收藏夹（仅允许删除空夹或级联删除夹内收藏）
  - [x] 5.3: 新增 `POST /items/:id/favorites`（body: folderId）加入收藏；`DELETE /items/:id/favorites?folderId=...` 移除收藏
  - [x] 5.4: 新增 `GET /me/favorites/folders/:id/items` 返回指定夹内条目（FeedItem 列表 + 收藏时间）
  - [x] 5.5: `GET /items/:id` 详情返回该条目已收藏的 folderId 列表
  - [x] 5.6: 运行 `corepack pnpm typecheck` 确认 api 包通过

## 阶段三：前端基础（头像 + Bug 修复 + API 封装）

- [ ] Task 6: 修复历史页 Tab 导航 Bug（`apps/web/src/app/history/page.tsx`）
  - [x] 6.1: 用 `useSearchParams()` 读取 `tab` 参数，替换原 `useEffect` 内一次性读取的逻辑；让 Tab 状态随 URL 变化响应
  - [x] 6.2: 点击 Tab 按钮时用 `router.replace` 更新 URL `tab` 参数（不产生多余历史）
  - [x] 6.3: 新增「最近投币」Tab（id=`coins`），展示 `recentCoins`，支持取消投币

- [ ] Task 7: 重做右上角头像（`apps/web/src/components/AppShell.tsx`）
  - [x] 7.1: 修复边界截断——将右下角徽标移出 `overflow-hidden` 圆形容器，或改用不裁剪徽标的结构（如外层 relative 包裹、徽标绝对定位到外层）
  - [x] 7.2: 优化视觉：简化渐变与徽标，保持与现有设计语言一致（teal accent）
  - [x] 7.3: 个人菜单新增「最近投币」「我的收藏」入口

- [ ] Task 8: 扩展前端 API 封装（`apps/web/src/lib/api.ts`）
  - [x] 8.1: `ActivityResponse` 增加 `recentCoins` 与 `stats.coins`；`ActivityEntry` 增加 `coined`/`coinedAt`
  - [x] 8.2: `ItemDetail.item` 增加 `coined`/`coinedAt`/`favoritedFolderIds`
  - [x] 8.3: 新增 `FavoriteFolder`、`FavoriteListResponse` 类型与对应请求函数封装

## 阶段四：前端功能（投币 + 收藏 UI）

- [ ] Task 9: 观看页投币与收藏按钮（`apps/web/src/app/watch/[id]/page.tsx`）
  - [x] 9.1: 在操作区新增「投币」按钮（Coins 图标），点击 toggle 投币，激活态高亮
  - [x] 9.2: 新增「收藏」按钮（Bookmark 图标），点击展开收藏夹选择浮层；展示已有收藏夹列表，已收藏的夹显示已选态，可多选加入/取消；支持新建收藏夹
  - [x] 9.3: 详情加载后正确回显投币态与收藏态

- [ ] Task 10: 收藏夹页面（`apps/web/src/app/favorites/page.tsx`，新增）
  - [x] 10.1: 列表视图：展示所有收藏夹卡片（名称 + 收藏数 + 更新时间），支持新建与删除
  - [x] 10.2: 详情视图：点击收藏夹进入夹内条目列表（复用 ActivityCard 风格），可移除单条
  - [x] 10.3: 空状态处理（无收藏夹 / 夹内无条目）

## 阶段五：验证与收尾

- [x] Task 11: 全量验证
  - [x] 11.1: 运行 `corepack pnpm lint`（apps/web 失败为预先存在的工具链问题，已在 main 复现）
  - [x] 11.2: 运行 `corepack pnpm typecheck`（全部 8 包通过）
  - [x] 11.3: 运行 `corepack pnpm build`（packages/shared 失败为预先存在的 tsconfig 问题，已在 main 复现）
  - [x] 11.4: API 运行时冒烟测试通过（投币 toggle、3 级交互传播、收藏 CRUD、推荐 feed 均正常）

- [ ] Task 12: 合并 main
  - [ ] 12.1: 在功能分支上提交所有变更
  - [ ] 12.2: 合并到 main 分支

# Task Dependencies
- Task 3、4、5 依赖 Task 1、2（数据模型与类型）
- Task 6、7、8 依赖 Task 1、2（类型）与 Task 4、5（API 契约）
- Task 9、10 依赖 Task 8（前端封装）与 Task 4、5（后端）
- Task 11 依赖所有前置 Task
- Task 12 依赖 Task 11
- Task 3（算法）与 Task 4、5（API）可在阶段一完成后并行
