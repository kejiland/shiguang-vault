# 拾光储藏室

一个把**图片**和**音乐**放在一起收藏的私人云端储藏室。前端、接口和权限校验运行在 Cloudflare Workers；原始文件保存在自己的 GitHub 私有仓库，并可按年手动备份到多个 GitLab 仓库。

## 已实现

- **图片与音乐分模块展示**：图片使用错落影像墙与大图查看；音乐使用唱片架、曲目表和固定播放器。
- **多个 GitHub 主仓库**：可在后台添加、编辑、停用、指定默认上传仓库。
- **多个 GitLab 备份仓库**：每个 GitLab 仓库绑定一个 GitHub 主仓库，上传新作品时不会重复出现在公共馆藏。
- **手动年度备份**：在「存储库」中为某个主仓库执行“全量备份”。备份按小批次进行，适合一年集中维护一次，不会自动定时消耗 Cloudflare 请求额度。
- **Cloudflare 同源代理**：浏览器只访问自己的站点；Worker 在服务端读取 GitHub/GitLab 文件并代理 `/media/:id`，不需要把访问令牌或私有仓库地址暴露给访客。
- **后台配置**：站点标题、副标题、描述、主色、公开/私密访问、下载权限、页脚和存储库都由后台管理。
- **私密模式**：未登录访客只能看到登录入口；作品列表、媒体文件和完整站点文案都需要管理员会话。公开模式则允许访客浏览。
- **安全基础**：管理员密码使用 PBKDF2 哈希；登录有频率限制；会话使用 HttpOnly Cookie；写操作校验同源请求与 CSRF；仓库 Token 使用 AES-GCM 加密后存入 D1。
- **操作记录**：上传、编辑、删除、备份和站点设置等关键操作会写入后台记录。

## 技术结构

```text
浏览器
  └─ Cloudflare Worker（页面 + API + 鉴权）
       ├─ Cloudflare D1（索引、设置、仓库配置、操作记录）
       ├─ GitHub API（主存储，多个私有仓库）
       └─ GitLab API（手动备份，多个私有仓库）
```

项目文件：

- Worker 与 API：`src/worker/`
- 展示站和工作台：`src/web/`
- D1 表结构：`migrations/`
- Cloudflare 配置：`wrangler.jsonc`
- 本地 Docker 测试：`Dockerfile`、`docker-compose.yml`

## 本地 Docker 测试

Docker 只用于本机验收，**不是线上部署方式**。当前测试地址：

```text
http://127.0.0.1:8790
```

管理员密码：首次部署时通过 /setup 设置

```text
首次部署时通过 /setup 设置
```

启动或重新构建：

```powershell
cd E:\储存柜
docker compose up -d --build
docker compose ps
```

查看日志与停止：

```powershell
docker compose logs -f vault
docker compose down
```

Docker 会把测试数据库保存在名为 `shiguang-vault_vault_state` 的卷中，重建容器不会丢失。若要彻底回到“首次设置”状态，可删除这个测试卷；这会清空本地测试数据，请先确认不需要保留：

```powershell
docker compose down -v
```

本地 `.env.docker.example` 只给出测试用示例值。正式环境的 `ENCRYPTION_KEY` 必须单独生成且妥善保管；一旦更换，已保存的仓库 Token 将无法解密，需要重新填写。

## 正式部署到 Cloudflare

以下命令在项目目录 `E:\储存柜` 中执行，需要 Node.js 20 或更高版本。

### 1. 登录 Cloudflare

```powershell
npx wrangler login
```

### 2. 创建 D1 数据库

```powershell
npx wrangler d1 create shiguang-vault
```

命令会返回真实的 `database_id`。打开 `wrangler.jsonc`，把下面这行占位值替换成返回的 ID：

```jsonc
"database_id": "00000000-0000-0000-0000-000000000000"
```

> 占位 ID 只能用于本地测试，不能直接部署到线上。

### 3. 设置加密密钥

生成一个足够长的随机字符串，然后保存为 Worker Secret：

```powershell
npx wrangler secret put ENCRYPTION_KEY
```

粘贴随机字符串并回车。不要把它写入 Git、README、截图或聊天记录。密钥必须长期保留；更换后需要重新填写所有仓库 Token。

### 4. 应用线上数据库迁移

```powershell
npm run db:migrate:remote
```

### 5. 构建并部署

```powershell
npm run deploy
```

部署完成后，用 Wrangler 输出的 `workers.dev` 地址打开 `/setup`，创建管理员密码。这个密码与仓库 Token 不同，至少 8 位，建议使用密码管理器生成并保存。

### 6. 绑定自定义域名（建议）

在 Cloudflare 控制台进入该 Worker 的 **Settings → Domains & Routes**，添加自己的域名。正式使用时建议：

- 使用 HTTPS 自定义域名；
- 保持 GitHub 与 GitLab 仓库为 Private；
- 不把 Token、D1 ID、加密密钥写进公开仓库；
- 为 Worker 开启访问日志，定期检查失败备份与异常登录。

## GitHub Token 配置

推荐使用 Fine-grained Personal Access Token，并只授权需要作为主存储的仓库。

在 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 创建 Token：

- **Repository access**：只选一个或数个私有媒体仓库；
- **Contents**：`Read and write`；
- **Metadata**：`Read-only`（通常会自动附带）。

回到后台「存储库 → 连接 GitHub」，填写：

- 所有者：GitHub 用户名或组织名；
- 仓库名：例如 `life-photos`；
- 分支：通常为 `main`；
- 存储子目录：可选，例如 `media`；
- Token：粘贴刚创建的 Token。

每个主题可以使用单独的仓库，例如 `life-photos`、`favorite-music`、`travel-archive`。在后台把其中一个设为主仓库的“默认上传仓库”。

## GitLab Token 配置

建议创建一个只访问备份项目的 Personal Access Token：

- **Scope**：`api`；
- 只给需要作为备份的私有项目授权（如使用项目访问令牌，则至少需要 `api` / 读写仓库权限）。

在后台「存储库 → 连接 GitLab」时，选择它对应的 **GitHub 主仓库**。GitLab 仓库只作为备份目标，不会直接接收新上传，也不会在展示页重复显示。

## 年度备份流程

建议每年固定一天执行：

1. 登录后台；
2. 打开「存储库」；
3. 找到 GitHub 主仓库，点击「全量备份」；
4. 页面会分批同步到绑定的 GitLab 备份仓库，并显示进度与失败数量；
5. 结束后点击 GitLab 仓库的「扫描」，核对备份状态；
6. 在「操作记录」确认出现 `repository.backup`；
7. 如出现失败，查看仓库卡片上的错误信息，修复 Token 或分支后再次执行。

备份是手动触发，不会在后台偷偷自动运行。大仓库建议分批完成，避免一次性消耗过多 Cloudflare 请求额度。

## Cloudflare 与 GitHub 网络说明

所有 GitHub/GitLab 请求都由 Worker 在服务端发出，浏览器不会直接连接这两个 API。这样私有仓库 Token 不会进入前端，也能避免部分网络环境下浏览器直连失败的跨域问题。

如果你在特定网络环境仍遇到 Worker 访问 GitHub 不稳定，可以在 Cloudflare 中把 Worker 的自定义域名和 API 请求统一走同源路径；本项目已按此设计，无需额外开放 GitHub 到浏览器的跨域权限。

## 内容上传与同步规则

- 图片支持 JPG、PNG、GIF、WebP、AVIF、SVG 等；单张最大 20 MB。
- 音乐支持 MP3、M4A、AAC、WAV、FLAC、OGG 等；单首最大 50 MB。
- 上传时会在文件名前加随机标识，避免同名覆盖。
- 上传会写入目标 GitHub 仓库，并生成一条 D1 索引。
- 「扫描」用于发现仓库里已有的图片/音乐；扫描不会因为远端暂时缺少文件就自动删除索引，删除必须显式执行。
- GitLab 备份库扫描只核对镜像状态，不会把同一作品重复导入展示页。
- 删除作品时：先删除主仓库文件；若主文件删除失败，会保留索引，避免产生无法管理的远端孤儿文件。

## 上线前检查清单

- [ ] `wrangler.jsonc` 已替换真实 D1 `database_id`
- [ ] 已执行远程 D1 迁移
- [ ] 已设置且备份 `ENCRYPTION_KEY`
- [ ] 首次 `/setup` 已创建管理员密码
- [ ] GitHub Token 权限已按最小范围配置
- [ ] GitLab Token 权限已按最小范围配置
- [ ] 私有仓库与私有站点访问方式已确认
- [ ] 已测试一次真实上传与播放
- [ ] 已测试一次单件备份和年度全量备份
- [ ] 已绑定自定义域名并确认 HTTPS

## 当前状态

本项目已在本地 Docker 环境完成构建、数据库迁移、管理员初始化、私密访问校验、设置保存、仓库新增/编辑/删除、桌面与手机布局验收。**尚未部署到 Cloudflare，也尚未使用真实 GitHub/GitLab Token 上传、播放或备份**；正式上线前请按上方步骤完成真实仓库验收。

已验证的本地行为：

- 私密站点未登录时返回隐藏文案，登录后显示后台保存的真实站点文案。
- 管理员初始化后访问 `/setup` 会自动进入工作台。
- 后台总览、内容库、上传、存储库、站点外观、操作记录在桌面和手机宽度下均可打开。
- 图片墙、大图查看、唱片架、曲目表、底部播放器、关于页和仓库编辑弹窗已完成模拟数据布局检查。
- 测试站的默认副标题与主色已恢复。

