# DriveSend

> 自托管的文件中心。网盘与「即时传输助手」不是两个产品，是同一套内核的两种策略。

<p>
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22.5-339933?logo=node.js&logoColor=white">
  <img alt="deps" src="https://img.shields.io/badge/npm%20dependencies-1-blue">
  <img alt="storage" src="https://img.shields.io/badge/storage-content--addressed-8b5cf6">
  <img alt="frontend" src="https://img.shields.io/badge/frontend-zero--build-0ea5e9">
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0-3da639">
</p>

## 一句话说清

**一次传输 = 一个带 TTL 的目录；网盘 = TTL 为 ∞ 的那一种。**

所以这个项目里没有两套系统：一套内容寻址存储、一套元数据、一条传输通道，
外挂两种策略对象——永久可浏览的目录树，和 24 小时后自动消失的「传输站」。

## 为什么

手机拍完照想立刻在电脑上看到，用网盘要「上传 → 打开电脑端 → 找文件夹 → 下载」四步；
用传输助手两步就够了，但传完的东西不是你的，不能整理、不能分享。

两者的差别其实只有**生命周期**，其余全部重合。既然如此，就没必要写两遍。

| 维度 | 网盘形态 | 传输站形态 | 是否复用 |
| --- | --- | --- | --- |
| 数据面 | 内容寻址分块存储 | 同一份存储 | 复用 |
| 控制面 | 目录树 / 版本 | TTL / 领取即删 | 同一套节点模型 |
| 传输 | 分块续传、秒传、Range | 同一套 | 复用 |
| 生命周期 | 永久 | 24 小时（可配） | 只差一个字段 |
| 交互 | 主动浏览 | 实时推送 + 领取 | 客户端能力 |

## 功能

| 能力 | 说明 |
| --- | --- |
| 内容寻址去重 | 同一内容只存一份，重复上传走「秒传」，一个字节都不用传 |
| 分块上传 | 4 MiB 分块，按偏移写入，支持重传同一块 |
| 断点下载 | 标准 HTTP Range（206），大文件可续传 |
| 传输站 | 手机上传 → 其他设备实时弹通知 → 「保存」或「保存并删除」 |
| 分享链接 | 1 小时 / 24 小时 / 7 天 / 永久，可撤销；文件和文件夹都能分享 |
| 分享落地页 | 打开即预览：图片/PDF/音视频/文本直接看，不用先下载 |
| 文件夹分享 | 接收方可逐层浏览、单独下载，或一键打包成 zip |
| 文件管理 | 目录树、新建文件夹、重命名、拖拽移动、多选批量操作 |
| 回收站 | 删除先进回收站，30 天后自动清除，可随时恢复或彻底删除 |
| 搜索 | 全盘按文件名搜索（FTS5 trigram 索引，中文子串也能命中；短查询回退 LIKE） |
| 分页 | 目录按需加载，每页 200 项，超出显示「加载更多」 |
| 断点续传 | 上传会话存在数据库里，服务重启后仍可从已写入的偏移继续 |
| 在线预览 | 图片、PDF、视频、音频、文本直接在页面内打开，可左右切换同目录文件 |
| 图片缩略图 | 列表中以缩略图代替通用图标（懒加载，超过 8 MB 的图片回退为图标） |
| PDF 缩略图 | 用 pdf.js 渲染第一页作为列表缩略图（并发 2，懒加载） |
| PDF 阅读器 | 自绘阅读器：翻页、缩放、适应宽度、Ctrl+滚轮缩放、方向键翻页 |
| PDF 缩略图 | 用 pdf.js 渲染第一页作为列表缩略图（并发 2，懒加载） |
| PDF 阅读器 | 自绘阅读器：翻页、缩放、适应宽度、Ctrl+滚轮缩放、方向键翻页 |
| 手机配对 | 传输站内生成二维码，扫码直接登录，无需输入令牌 |
| 账户 | 用户名 + 密码登录，scrypt 哈希，会话 30 天 |
| 配额 | 默认 15 GB，侧栏显示用量条，超限上传前拦截 |
| 存储统计 | 区分「逻辑占用」与「实际占用」，直观看到去重省了多少 |

界面为 iOS / macOS 风格的磨砂玻璃主题，零构建、零框架。

## 账户与配额

首次打开实例会引导创建账户（用户名 + 密码），之后用账号登录，会话保存在 HttpOnly Cookie 里 30 天。

- 密码用 `scrypt` 加盐哈希存储，登录失败按 IP 限速（15 分钟内 10 次）
- 支持多个账户，但**文件是共享的**：这套东西定位是单人自托管，多用户隔离需要给节点加 owner，
  属于另一个量级的改动，暂未做
- `DS_TOKEN` 是应急钥匙：即使一个账户都没有，用 `?token=xxx` 或 Bearer 仍能进入，
  避免忘记密码后彻底锁死

配额默认 15 GB（`QUOTA_BYTES` 可改），按**所有文件**计算，包括回收站里的内容——
因为它们在磁盘上确实占着空间。超出时上传会在开始前就被拒绝，并提示剩余多少。

## 快速开始

需要 Node.js 22.5 以上（依赖内置 `node:sqlite`）。

```bash
git clone git@github.com:pridelizihao/drivesend.git
cd drivesend
node src/server.ts
```

打开 http://127.0.0.1:8787 即可。默认无鉴权，仅供本机使用。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录（SQLite + blob 存储） |
| `DS_TOKEN` | 空 | 应急令牌。设置后可用 `?token=` 或 Bearer 绕过账号直接访问 |
| `QUOTA_BYTES` | `16106127360`（15 GB） | 存储配额，按所有文件（含回收站）计算 |
| `UPLOAD_TTL_H` | `24` | 未完成的上传会话保留小时数，超时后连同临时文件一起清理 |
| `SESSION_DAYS` | `30` | 登录会话有效天数 |
| `BASE_PATH` | 空 | 子路径部署前缀，如 `/drive` |
| `INBOX_TTL_H` | `24` | 传输站文件存活小时数 |
| `TRASH_TTL_H` | `720` | 回收站保留小时数（默认 30 天） |

## 架构

```
          客户端（桌面浏览器 / 手机浏览器）
  ┌──────────────────────────────────────────────┐
  │  零构建前端 · 拖拽上传 · EventSource 实时推送  │
  └───────┬──────────────────────────────┬───────┘
          │ HTTP / HTTPS                 │ SSE
          ▼                              ▼
  ┌──────────────────────────────────────────────┐
  │  接入层  单进程 http.Server，无框架路由        │
  │  鉴权    令牌 + Cookie + Bearer                │
  │  传输    分块上传 · Range 下载 · 秒传判定      │
  ├──────────────────────────────────────────────┤
  │  元数据  SQLite（node:sqlite，进程内）         │
  │          blobs / nodes / shares               │
  ├──────────────────────────────────────────────┤
  │  存储    内容寻址：blobs/<aa>/<bb>/<sha256>    │
  │          引用计数 + 孤儿回收                   │
  └──────────────────────────────────────────────┘
```

### 几个关键实现

**内容寻址。** 文件按 SHA-256 落盘，路径由哈希推导，由此免费获得去重、秒传、完整性校验。
配合 `blobs.refs` 引用计数，节点全部删除后引用归零，超过 1 小时再由后台任务回收物理文件。

**简化版 tus 上传。** `PUT /api/upload/:id?offset=N` 写入裸字节，客户端失败可重传同一块；
完成时服务端重新计算哈希并与客户端声明值比对，防止传输损坏。

**SSE 而不是 WebSocket。** 只需要服务端单向推送时，SSE 是一个普通 HTTP 响应，浏览器自带重连。
代价是反向代理必须关闭缓冲（`proxy_buffering off`）。

**纯 JS 流式 SHA-256 兜底。** 浏览器 `crypto.subtle` 只在安全上下文（HTTPS / localhost）可用，
HTTP 部署下它不存在。因此内置了一份增量式 SHA-256（常数内存，边界长度已与原实现逐字节对齐），
让秒传在纯 HTTP 环境下依然可用。

## 数据模型

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `blobs` | `hash` · `size` · `refs` | 物理内容，全局唯一 |
| `nodes` | `id` · `parent_id` · `name` · `kind` · `blob_hash` · `expires_at` · `deleted` | 目录树，文件与文件夹统一建模 |
| `shares` | `token` · `node_id` · `expires_at` | 分享链接 |

目录树使用邻接表；移动只改一个字段，删除为软删除 + 引用计数递减。

## API

```
POST   /api/upload/init            秒传判定 / 开启上传会话
PUT    /api/upload/:id?offset=     写入一个分块（原始字节）
POST   /api/upload/:id/complete    校验哈希 → 落 CAS → 建节点
GET    /api/download/:id           下载，支持 Range
GET    /api/download/:id?inline=1  预览：仅图片/PDF/音视频/文本内联，SVG 与 HTML 强制下载
GET    /api/download/:id?burn=1    下载完成后立即删除（传输站领取）

GET    /api/files?parent=&limit=&offset=  列目录 + 面包屑 + 分页信息
POST   /api/folders                新建文件夹
POST   /api/nodes/:id/rename       重命名
POST   /api/nodes/:id/move         移动（防环、重名自动加序号）
DELETE /api/nodes/:id              删除，进入回收站
DELETE /api/nodes/:id?purge=1      永久删除（不经过回收站）
POST   /api/nodes/:id/restore      从回收站恢复
GET    /api/nodes/:id/versions     历史版本列表
GET    /view/:id                   独立阅读页（原生 PDF 阅读器 + 上传新版本）
GET    /api/trash                  回收站列表
DELETE /api/trash                  清空回收站
GET    /api/search?q=              按文件名搜索

GET    /api/inbox                  传输站列表
POST   /api/shares                 创建分享链接
GET    /api/shares                 链接列表
DELETE /api/shares/:token          撤销链接
GET    /s/:token                   分享落地页（文件预览 / 文件夹列表）
GET    /s/:token?p=<id>            浏览分享内的子目录或查看单个文件
GET    /s/:token/download?p=<id>   下载单个文件；对文件夹返回 zip
GET    /s/:token/download?p=<id>&inline=1  内联预览（SVG/HTML 强制下载）

POST   /api/auth/setup             创建首个账户
POST   /api/auth/login             登录
POST   /api/auth/logout            退出
GET    /api/auth/me                当前用户 / 是否需要初始化
GET    /api/state                  统计、配额与当前用户
GET    /api/pair-url               生成带令牌的登录地址（供二维码）
GET    /api/events                 SSE：inbox / files 事件
```

## 部署

以 systemd + nginx 反向代理为例。

```ini
# /etc/systemd/system/drivesend.service
[Unit]
Description=DriveSend
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/drivesend
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=DATA_DIR=/opt/drivesend/data
Environment=BASE_PATH=/drive
Environment=DS_TOKEN=请替换为随机令牌
ExecStart=/usr/bin/node src/server.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```nginx
location = /drive { return 301 /drive/; }

location /drive/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;        # SSE 必须关闭缓冲
    proxy_read_timeout 3600s;
    client_max_body_size 64m;
}
```

`proxy_pass` 结尾的斜杠会剥掉 `/drive` 前缀；服务端的 `BASE_PATH` 负责生成正确的绝对链接与 Cookie 路径。
两者必须成对配置，否则登录跳转会指向错误位置。

## 安全模型

- 账号密码保护所有 API，会话写入 HttpOnly Cookie，有效期 30 天。
- `DS_TOKEN` 作为应急钥匙保留：可绕过账号访问，用于自动化脚本或找回访问权。
- **分享链接不需要令牌**——这是分享的语义。令牌为 96 位随机串，无法猜测，但链接一旦转发即等同放行。
- 传输站文件默认 24 小时过期，领取即可删除。
- 当前无内置 TLS。公网部署请在前面加一层 HTTPS，否则令牌与文件内容均为明文传输。
- 预览接口按扩展名白名单判定：图片（SVG 除外）、PDF、音视频、纯文本可以内联渲染，
  SVG 与 HTML 一律降级为下载。否则用户上传的 HTML 会和主应用同源，能读取会话 Cookie。

## 设计取舍

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| 整文件级内容寻址，而非块级 | 秒传、去重、校验一次到位 | 改一个字节要重传整个文件 |
| 简化版 tus 语义，而非标准 tus | 六十行代码解决问题 | 标准 tus 客户端不能直接使用 |
| SQLite 单文件数据库 | 零运维，单机足够 | 水平扩展需要换 Postgres |
| 全文索引用 FTS5 trigram | 中文子串搜索可用，不引入外部搜索引擎 | 索引与表同库，占用随文件名增长；少于 3 字符仍走 LIKE |
| 文件夹下载用自写 zip | 无需引入压缩库，零依赖 | 不支持 ZIP64，单包需小于 4 GB / 65535 项 |
| 多步写操作包在事务里 | 崩溃或断电不会留下半更新状态 | 事务期间写锁串行，极高并发下会成为瓶颈 |
| 前端零构建、无框架 | 改完刷新即生效 | 状态管理手写，规模再大需要重构 |
| 缩略图由浏览器缩放原图 | 不引入图片库，保持零依赖 | 会下载完整文件；图片多的目录首次加载偏慢 |
| PDF 渲染用 pdf.js（随仓库分发） | 列表缩略图必须真渲染，浏览器做不到 | 增加约 1.4 MB 静态资源 |
| PDF 预览交给浏览器原生阅读器 | 原生阅读器自带缩放、搜索、目录，自绘很难追平 | 浏览器不会把批注写回文件，只能"另存为后上传新版本" |
| 替换版本保留旧内容 | 编辑传回时不会丢东西 | 旧版本常驻磁盘，暂未提供清理入口 |
| PDF 渲染用 pdf.js（随仓库分发） | 浏览器无法把 PDF 直接画成缩略图，必须真渲染 | 增加约 1.4 MB 静态资源，仅 PDF 场景才下载 |
| SSE 而非 WebSocket | 只需要单向推送 | 双向实时协作场景不适用 |
| 单用户模型 | 自托管场景绝大多数是单人 | 多用户需增加 owner_id 与配额 |

## 测试

仓库内是可直接运行的端到端测试，不依赖任何测试框架：

```bash
node test/smoke.mjs      # 网盘主流程（19 项断言）
node test/move.mjs       # 移动与防环规则（9 项断言）
node test/inbox.mjs      # 传输站流程（10 项断言）
node test/trash.mjs      # 回收站、恢复、搜索（16 项断言）
node test/delete.mjs     # 删除语义与空间回收（9 项断言）
node test/preview.mjs    # 预览内联白名单与安全头
node test/auth.mjs       # 账户、会话与配额（21 项断言）
node test/version.mjs    # 版本替换与阅读页（11 项断言）
node test/share.mjs      # 分享链接去重（4 项断言）
node test/paging.mjs     # 分页、全文检索、上传持久化、事务（17 项断言）
node test/sharepage.mjs  # 分享页预览、文件夹浏览、zip、越权访问（23 项断言）
node test/sha256.mjs     # 纯 JS SHA-256 与原生实现比对
```

针对已部署实例运行时，传入 `BASE` 与 `DS_AUTH`：

```bash
BASE=https://drive.example.com/drive DS_AUTH=<token> node test/smoke.mjs
```

## 路线图

- [x] 内容寻址存储与引用计数
- [x] 分块上传、秒传、Range 下载
- [x] 传输站（TTL、实时推送、领取即删）
- [x] 分享链接、移动、重命名、二维码配对
- [x] 回收站、全盘搜索、多选批量操作
- [x] 在线预览（图片 / PDF / 音视频 / 文本）
- [x] PDF 独立阅读页与版本替换
- [x] 账号密码登录、存储配额
- [x] 写操作事务化、上传会话持久化、目录分页、FTS5 全文检索
- [x] 分享页预览、文件夹分享与打包下载
- [ ] 局域网直连（mDNS 发现 + 不经服务器的直传）
- [ ] 块级去重与增量同步
- [ ] 回收站
- [ ] 多用户与配额
- [ ] HTTPS 一键配置

## 贡献者

- **李子豪** — 产品设计与实现 · [@pridelizihao](https://github.com/pridelizihao)
- **DeepSeek AI** — 协同开发与测试 · [@deepseek-aibot](https://github.com/deepseek-aibot)

## 许可证

[AGPL-3.0-or-later](./LICENSE)。

可以自由使用、修改、分发。但如果你修改后**把它作为网络服务提供给他人访问**，
必须同样以 AGPL-3.0 公开你的修改源码。这是有意的选择：这套东西的定位就是自托管工具，
不应该被改造成一个不透明的收费网盘。
