# AuraFlow Music Player

AuraFlow 是一个沉浸式网页音乐播放器。前端使用原生 HTML、CSS 和 JavaScript，后端使用 Cloudflare Pages Functions，并通过 R2 保存音乐文件、D1 保存歌曲元数据。

## 功能

- 拖拽或选择本地音频文件添加歌曲
- Cloudflare 可用时自动上传歌曲到 R2
- D1 保存歌曲名、格式、大小、时长、收藏状态、播放次数和上次播放位置
- 播放、暂停、上一首、下一首、顺序播放、单曲循环、列表循环、随机播放
- 音量、静音、进度拖动、快捷键控制
- Canvas 音频可视化、主题切换、自定义背景图
- 移动端播放列表抽屉

## 项目结构

```text
.
├── index.html
├── style.css
├── app.js
├── schema.sql
├── wrangler.toml
└── functions
    └── api
        ├── upload.js
        ├── songs
        │   ├── index.js
        │   └── [id].js
        └── stream
            └── [id].js
```

## 本地运行

如果只想体验前端本地播放，可以用任意静态服务器打开项目目录。此时 `/api` 不可用，播放器会退回本地 blob 播放模式。

推荐使用 Wrangler 运行完整 Pages Functions 环境：

```bash
wrangler pages dev .
```

## Cloudflare 部署

1. 创建 R2 bucket，例如 `auraflow-music`。
2. 创建 D1 database，例如 `auraflow-db`。
3. 修改 `wrangler.toml` 中的 R2 和 D1 配置，尤其是 `database_id`。
4. 初始化 D1 表结构：

```bash
wrangler d1 execute auraflow-db --file=schema.sql
```

5. 部署到 Cloudflare Pages，并确保 Pages Functions 可以访问 `MUSIC_BUCKET` 和 `DB` 绑定。

## API

- `GET /api/songs`：获取歌曲列表。
- `POST /api/upload`：上传音频文件到 R2，并写入 D1。
- `PATCH /api/songs/:id`：更新收藏、播放次数、时长、上次播放位置。
- `DELETE /api/songs/:id`：删除 R2 文件和 D1 记录。
- `GET /api/stream/:id`：流式播放歌曲，支持 Range 请求。

## 注意事项

- 当前使用固定公共音乐库 `public_library`，所有设备和浏览器都会看到同一批歌曲。
- 公共库不是强鉴权，生产环境建议增加登录鉴权、上传大小限制、CORS 白名单和频率限制。
- 大文件播放依赖浏览器 Range 请求，`stream/[id].js` 已按 Range 从 R2 读取片段，避免把整首歌读入内存。
