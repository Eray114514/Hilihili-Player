# Checklist

## 数据模型
- [x] `interactions.kind` 枚举包含 `coin`（schema.ts + shared）
- [x] `item_preferences` 新增 `coined`（boolean）与 `coinedAt`（text）列，内联迁移 `ensureColumn` 生效
- [x] 新增 `favorite_folders` 表（id / name / created_at）
- [x] 新增 `favorites` 表（id / folder_id / item_id / created_at，folder_id+item_id 唯一，folder_id 外键 cascade）
- [x] 新增表在 `migrate()` 中有 `CREATE TABLE IF NOT EXISTS` 与索引

## 后端 API
- [x] `PUT /items/:id/coin` 能 toggle 投币，写入 `coin` 交互（item/creator/category 三级）
- [x] `GET /items/:id` 返回 `coined` 与 `coinedAt`
- [x] `GET /me/activity` 返回 `recentCoins` 列表与 `stats.coins`
- [x] `GET /me/favorites` 返回收藏夹列表（含 itemCount / updatedAt）
- [x] `POST /me/favorites/folders` 能创建收藏夹
- [x] `DELETE /me/favorites/folders/:id` 能删除收藏夹
- [x] `POST /items/:id/favorites` 能加入收藏（首次自动建默认夹）
- [x] `DELETE /items/:id/favorites?folderId=` 能移除收藏
- [x] `GET /me/favorites/folders/:id/items` 返回夹内条目
- [x] `GET /items/:id` 返回 `favoritedFolderIds`

## 推荐算法
- [x] `interactionWeight` 对 coin/like/finish/watch/dislike 应用差异化权重
- [x] 交互权重应用时间衰减 `exp(-ageDays/45)`
- [x] `finish` 交互纳入 creator/category 亲和度
- [x] 多样性重排：同 creator 不在结果中过度集中
- [x] 算法在无交互数据时仍能正常返回（探索项兜底）

## 前端 - 头像
- [x] 右下角徽标不被 `overflow-hidden` 截断
- [x] 头像视觉干净，与设计语言一致

## 前端 - 历史 Tab Bug
- [x] 用 `useSearchParams()` 响应 URL `tab` 变化
- [x] 从个人菜单跳转 `/history?tab=xxx` 时页面 Tab 立即切换（无需返回主页）
- [x] 点击 Tab 按钮用 `router.replace` 更新 URL

## 前端 - 投币
- [x] 观看页有「投币」按钮，点击 toggle，激活态高亮
- [x] 历史页有「最近投币」Tab，按投币时间倒序展示
- [x] 个人菜单有「最近投币」入口
- [x] 投币态在详情加载后正确回显

## 前端 - 收藏
- [x] 观看页有「收藏」按钮，展开收藏夹选择浮层
- [x] 收藏夹浮层支持多选加入/取消，支持新建夹
- [x] `/favorites` 页面展示收藏夹卡片列表
- [x] 收藏夹详情展示夹内条目，可移除单条
- [x] 空状态正确处理
- [x] 个人菜单有「我的收藏」入口
- [x] 收藏态在详情加载后正确回显

## 验证
- [x] `corepack pnpm typecheck` 通过（全部 8 包）
- [ ] `corepack pnpm lint` 通过 — apps/web 失败为**预先存在**的工具链不兼容（eslint-plugin-react@7.37.5 vs ESLint 10），与本次改动无关，已在原始 main 上复现
- [ ] `corepack pnpm build` 通过 — packages/shared 失败为**预先存在**的 tsconfig rootDir 配置问题，与本次改动无关，已在原始 main 上复现
- [x] 安全演示手动验证全部场景通过（API 运行时冒烟测试：投币 toggle、3 级交互传播、收藏 CRUD、推荐 feed 均正常）
- [x] 变更已合并到 main
