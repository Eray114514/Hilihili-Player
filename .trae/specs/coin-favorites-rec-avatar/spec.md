# 投币 / 收藏 / 推荐算法 / 头像优化 Spec

## Why
当前 Hilihili Player 只有「点赞/不喜欢」一种正向表达，缺少更强的「投币」信号和「收藏」能力，推荐算法也较为基础（无时间衰减、无多样性重排），无法真正「懂我」。同时右上角头像存在边界截断缺陷、历史页 Tab 切换存在导航 Bug，影响基础体验。本次变更一次性补齐这些核心能力。

## What Changes

### UI
- 重做右上角头像：修复 `overflow-hidden` 把右下角播放徽标截断的问题，整体视觉更干净。
- 新增「投币」功能：观看页新增投币按钮，「最近投币」作为历史页新 Tab 与个人菜单入口。
- 新增「收藏」功能：新增收藏夹页面 `/favorites`，支持多收藏夹；观看页新增收藏按钮（含收藏夹选择）；个人菜单新增收藏入口。
- 修复历史页 Tab 导航 Bug：从个人菜单跳转 `/history?tab=likes` 时页面不更新。

### 后端
- 扩展投币支持：`点赞=喜欢`，`投币=非常喜欢`。投币作为独立、更强的正向信号。
- 优化推荐算法：引入时间衰减、投币/看完加权、多样性重排，使其更现代、更懂用户。

### 数据模型
- `interactions.kind` 枚举新增 `coin`。
- `item_preferences` 新增 `coined`（布尔）与 `coined_at`（时间戳）列。
- 新增 `favorite_folders` 表（id / name / created_at）。
- 新增 `favorites` 表（id / folder_id / item_id / created_at，folder_id+item_id 唯一）。

## Impact
- Affected code:
  - `packages/db/src/schema.ts`、`packages/db/src/index.ts`（schema + 内联迁移）
  - `packages/shared/src/index.ts`（`InteractionKind` 增加 `coin`，新增收藏相关类型）
  - `packages/recommendation/src/index.ts`（算法重写）
  - `apps/api/src/index.ts`（投币/收藏/活动接口）
  - `apps/web/src/components/AppShell.tsx`（头像重做 + 个人菜单 + 历史 Tab Bug）
  - `apps/web/src/app/history/page.tsx`（Tab 同步 URL + 新增投币 Tab）
  - `apps/web/src/app/watch/[id]/page.tsx`（投币/收藏按钮）
  - `apps/web/src/app/favorites/page.tsx`（新增收藏夹页面）
  - `apps/web/src/lib/api.ts`（新增类型与请求封装）
- **BREAKING**：无对外契约破坏（自托管单用户，DB 内联迁移自动升级）。

## ADDED Requirements

### Requirement: 投币功能
系统 SHALL 提供投币能力，投币表示「非常喜欢」，是比点赞更强的正向信号。

#### Scenario: 用户在观看页投币
- **WHEN** 用户在观看页点击「投币」按钮
- **THEN** 该条目被标记为已投币，按钮变为激活态；同时写入 `coin` 交互（item / creator / category 三级），用于推荐加权
- **AND** 若该条目尚未点赞，投币不强制改变点赞状态（两者独立）

#### Scenario: 取消投币
- **WHEN** 用户再次点击已投币条目的「投币」按钮
- **THEN** 投币状态取消，`item_preferences.coined` 置 0

#### Scenario: 查看最近投币
- **WHEN** 用户进入历史页「最近投币」Tab
- **THEN** 按投币时间倒序展示已投币条目，每条显示投币时间，可取消投币

### Requirement: 收藏功能
系统 SHALL 提供收藏夹能力，用户可创建多个收藏夹并将条目收藏到指定收藏夹。

#### Scenario: 首次收藏自动建默认夹
- **WHEN** 用户在观看页点击「收藏」且当前无任何收藏夹
- **THEN** 系统自动创建「默认收藏夹」并将该条目收藏其中

#### Scenario: 收藏到指定夹
- **WHEN** 用户点击「收藏」并已有收藏夹
- **THEN** 弹出收藏夹选择列表，用户选择目标夹后条目加入该夹；已收藏过的夹显示已选态，可取消

#### Scenario: 浏览收藏夹页面
- **WHEN** 用户进入 `/favorites`
- **THEN** 展示所有收藏夹卡片（名称 + 收藏数 + 更新时间），点击进入查看夹内条目列表
- **AND** 支持新建收藏夹、删除空收藏夹

#### Scenario: 收藏夹内条目
- **WHEN** 用户进入某收藏夹详情
- **THEN** 按收藏时间倒序展示条目，可移除单条；点击条目跳转观看页

### Requirement: 头像重做
系统 SHALL 修复右上角头像的边界截断问题并优化视觉。

#### Scenario: 头像正常显示
- **WHEN** 任意页面加载
- **THEN** 右上角头像完整显示，右下角徽标不被圆形容器的 `overflow-hidden` 截断；视觉干净不杂乱

### Requirement: 历史 Tab URL 同步
系统 SHALL 让历史页 Tab 状态与 URL 查询参数双向同步。

#### Scenario: 从个人菜单跳转切换 Tab
- **WHEN** 用户已停留在 `/history?tab=history`，从个人菜单点击「最近点赞」跳转到 `/history?tab=likes`
- **THEN** 页面不重新挂载，但 Tab 与列表立即切换到「最近点赞」
- **AND** URL 反映当前 Tab

#### Scenario: 点击 Tab 按钮更新 URL
- **WHEN** 用户在历史页点击某个 Tab 按钮
- **THEN** URL 查询参数 `tab` 更新为该 Tab（`router.replace`，不产生多余历史记录）

## MODIFIED Requirements

### Requirement: 推荐算法
推荐算法 SHALL 综合时间衰减的交互信号、投币/看完加权、内容新鲜度与多样性，输出更懂用户的排序。

评分模型：
- 对每个候选，按 target（creator / category / tag）聚合交互，应用时间衰减 `exp(-ageDays / 45)`：
  - `coin`：`value * 4 * decay`（最强正向）
  - `like`：`value * 2 * decay`
  - `finish`：`value * 1.5 * decay`（看完 = 喜欢）
  - `watch`：`value * 0.15 * decay`（弱曝光信号）
  - `dislike`：`-value * 3 * decay`
- 内容新鲜度：`max(0, 1 - ageDays / 60) * 0.5`
- 探索：`seededRandom(seed:id) * 2.0`
- 多样性重排：排序后对同 creator 在结果中过度集中的条目施加惩罚，避免单一 UP 刷屏

#### Scenario: 投币过的 UP 获得更高权重
- **WHEN** 用户对某 UP 的视频投过币
- **THEN** 该 UP 的其他视频在推荐中获得显著高于普通点赞的加权

#### Scenario: 近期行为权重更高
- **WHEN** 用户最近一周频繁点赞某分区，一个月前也点赞过另一分区
- **THEN** 最近一周的分区在推荐中权重更高（时间衰减生效）

#### Scenario: 单一 UP 不刷屏
- **WHEN** 某 UP 有大量高分视频
- **THEN** 推荐结果中该 UP 的视频不会连续占据多条，多样性重排保证内容来源分散

## REMOVED Requirements
无。
