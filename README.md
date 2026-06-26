# Hilihili Player

Hilihili Player 是一个局域网内自用的视频网站。它直接读取本机或 NAS 挂载目录，按“分区 / UP 主 / 视频 / 分 P”建立索引，并在网页端提供推荐、动态、播放、评论笔记和可视化媒体库设置。

## 当前完成度

- Monorepo：Next.js Web、Fastify API、后台 Worker、SQLite/Drizzle 数据层。
- 媒体库：支持多个根目录、可视化目录浏览、标准结构扫描、非法结构兜底、`_待归类` 纳入索引。
- 推荐：看完排除、点赞/点踩权重、UP 拉黑、探索随机。
- 播放：自定义播放器、Range 流、5 秒跳转、倍速、长按 3x、多 P。
- PWA：manifest 与可安装基础壳。
- 部署：Docker Compose 与 GHCR 镜像构建 workflow。

## 开发

```bash
corepack pnpm install
corepack pnpm dev
```

默认端口：

- Web: `http://localhost:3000`
- API: `http://localhost:4141`

复制 `.env.example` 为 `.env` 后可调整数据目录和端口。

### 隐私安全演示模式

需要调试界面、播放和扫描功能，但不希望读取真实媒体库时，运行：

```bash
corepack pnpm dev:safe
```

浏览器打开 `http://localhost:3100`。该模式会生成彩条视频和测试图片，使用独立数据库与缓存，并把 API 文件访问限制在 `.hilihili-safe-demo/safe-demo-library` 内；真实 `app-data` 和媒体目录不会被读取。

## 视频库结构

```text
Library_Root/
├── _tags.json
├── 分区A/
│   ├── UP主甲/
│   │   ├── [2024-05] 视频标题/
│   │   │   ├── cover.jpg
│   │   │   ├── P1.mp4
│   │   │   └── P2.mp4
│   │   └── [2024-06] 单P视频.mp4
│   └── _无UP主/
└── _待归类/
```

`_` 前缀目录默认跳过，`_待归类` 是例外。非法结构不会被丢弃，会以兜底分类入库。

### UP 与内容资料

UP 目录可放置一个 `info.json`。头像和横幅均为该目录下的相对图片路径；不配置时，Hilihili 会自动生成稳定的渐变横幅和首字头像。

```json
{
  "alias": "显示别名",
  "description": "UP 的个人简介",
  "avatar": "avatar.jpg",
  "banner": "banner.jpg"
}
```

视频/图集目录的 `info.json`，或单文件旁的 `视频名.info.json`，还可使用 `description` 作为播放页简介；图文动态仍优先展示 `post.txt` 正文。同一媒体库中同名 UP 会聚合到同一个主页；特别关注后，新扫描到的视频会出现在“视频消息”中。

## NAS 自动更新

推荐流程：

1. 推送代码到 GitHub。
2. GitHub Actions 构建镜像并推送到 GHCR。
3. NAS 使用 `docker-compose.yml` 启动服务。
4. NAS 上安装 Watchtower，自动拉取 Web 与后端镜像的新版本。

镜像名必须全小写；本仓库发布 `ghcr.io/eray114514/hilihili-player:web` 与 `ghcr.io/eray114514/hilihili-player:backend` 两个标签，`docker-compose.yml` 会分别用于 Web 和 API/Worker。NAS 不需要把 Docker 默认镜像源改成 GHCR，镜像地址里的 `ghcr.io` 会让 Docker 直接从 GitHub Container Registry 拉取。仓库和 package 如果保持私有，需要先在 NAS 上执行一次：

```bash
docker login ghcr.io -u Eray114514
```

密码使用 GitHub Personal Access Token，至少需要 `read:packages` 权限；如果 GHCR package 改成公开，则 NAS 可以免登录拉取。

示例：

```bash
GHCR_OWNER=eray114514 HILI_MEDIA_ROOT=/volume1/video docker compose up -d
```
