# 拾光储藏室

一个开源、可自托管的**图片与音乐收藏站**。前端、API、权限校验和媒体代理运行在 Cloudflare Workers；原始文件保存在自己的 GitHub 私有仓库，新文件会自动增量备份到多个 GitLab 私有仓库。

> 这是一个需要自行部署和配置的开源项目，不提供公共演示站、公共上传空间或内置存储额度。

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![GitHub](https://img.shields.io/badge/Storage-GitHub-181717?logo=github&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

## 功能

- **图片与音乐分模块展示**：图片使用影像墙和大图预览；音乐使用唱片架、曲目表和播放器。两类内容拥有独立的搜索、分页和布局。
- **首页精简展示**：图片每页 8 张，音乐每页 6 首，分别独立翻页。
- **多个 GitHub 主仓库**：后台可添加、编辑、停用和指定默认上传仓库。
- **多个 GitLab 备份仓库**：每个备份库绑定一个 GitHub 主仓库；新上传会自动增量备份，同名文件自动跳过，也可手动全量备份补齐历史内容。
- **WebP 自动优化**：JPG、JPEG、PNG、BMP 在上传前由浏览器尝试转换为 WebP；转换失败或体积变大时保留原图。
- **自动识别音乐信息**：读取音乐标题、艺术家、专辑和时长；展示层优先使用识别或手动填写的信息。
- **公开分享链接**：可为单件作品生成永久或限期分享链接，并复制直接访问链接与 Markdown。分享可随时撤销。
- **后台配置**：站点标题、副标题、描述、主色、公开/私密模式、下载权限、页脚、仓库和分享均由后台管理。
- **Cloudflare 同源代理**：浏览器只访问本站；Worker 服务端读取 GitHub/GitLab 内容，不向前端暴露访问令牌和私有仓库地址。
- **安全基础**：PBKDF2 密码哈希、登录限流、HttpOnly 会话 Cookie、同源与 CSRF 校验、AES-GCM 加密仓库令牌。
- **操作审计**：上传、编辑、删除、备份和设置变更会写入操作记录。

## 技术架构

```text
浏览器
  └─ Cloudflare Worker（静态页面 + API + 鉴权 + 媒体代理）
       ├─ Cloudflare D1（索引、设置、仓库配置、分享、操作记录）
       ├─ GitHub API（主存储；可配置多个私有仓库）
       └─ GitLab API（自动增量备份；可配置多个私有仓库）
```

主要目录：

```text
src/web/          React 展示站与管理后台
src/worker/       Cloudflare Worker、API、存储适配与鉴权
migrations/       D1 数据库迁移
scripts/          辅助脚本
wrangler.jsonc    Cloudflare Worker 与 D1 配置
Dockerfile        本地测试镜像
docker-compose.yml 本地测试编排
```

## 环境要求

- Node.js 20 或更高版本
- npm
- Cloudflare 账号
- 用于存放媒体的 GitHub 私有仓库
- 可选：GitLab 账号与私有备份仓库
- 可选：Docker，仅用于本地验收

## 快速开始

### 1. 安装依赖

```powershell
npm install
```

### 2. 启动本地开发环境

复制开发环境变量示例，并按需修改：

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

开发服务器会同时启动 Vite 前端与 Wrangler 本地 Worker。具体地址以终端输出为准。

### 3. 初始化本地数据库

如本地尚未应用迁移：

```powershell
npm run db:migrate:local
```

打开本地站点进入 `/setup`，创建管理员密码。首次登录后系统会要求设置新密码；部署时请使用独立、强随机密码。

### 4. 使用 Docker 测试

```powershell
docker compose up -d --build
docker compose ps
```

默认测试端口为 `8790`。Docker 仅用于本机测试，不是线上生产部署方式。

查看日志和停止服务：

```powershell
docker compose logs -f vault
docker compose down
```

若要清空本地测试数据：

```powershell
docker compose down -v
```

## 部署到 Cloudflare

本项目提供三条部署路径。首次部署推荐 **Workers Builds（Cloudflare 控制台连接 GitHub）**；已经能在本地登录 Wrangler 时可用命令行部署。

| 方式 | 适合场景 | 触发方式 | 密钥保存位置 |
| --- | --- | --- | --- |
| Cloudflare Workers Builds | 希望推送后自动构建部署 | 连接 GitHub 后，推送 `main` | Cloudflare Secret |
| GitHub Actions | 希望由 GitHub 记录构建与部署过程 | 在 Actions 页面手动触发 | GitHub Secrets |
| 本机 Wrangler | 首次配置、调试或紧急发布 | 本地执行命令 | 本机 Wrangler |

> 无论选哪种方式，都必须先创建 D1、替换 `wrangler.jsonc` 的占位值、执行数据库迁移，并设置 `ENCRYPTION_KEY`。`ENCRYPTION_KEY` 只能保存为 Worker Secret，不能写进 `wrangler.jsonc`、README 或 GitHub 仓库。

### 部署前准备

#### 1. 创建 D1 数据库

```powershell
npx wrangler login
npx wrangler d1 create <your-d1-database-name>
```

将命令返回的数据库 ID 写入 `wrangler.jsonc`：

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "<your-d1-database-name>",
      "database_id": "<your-d1-database-id>",
      "migrations_dir": "migrations"
    }
  ]
}
```

`binding` 必须保持为 `DB`，因为项目的迁移脚本通过这个绑定查找数据库。仓库默认值是占位符，不能直接用于生产部署。

#### 2. 设置加密密钥

`ENCRYPTION_KEY` 用于加密后台保存的 GitHub/GitLab Token：

```powershell
npx wrangler secret put ENCRYPTION_KEY
```

使用密码管理器生成足够长的随机值。首次创建 Worker 时可先执行一次 `npm run deploy`，再到 Cloudflare **Workers → 对应 Worker → Settings → Variables and Secrets** 添加 Secret；也可以先执行 `wrangler secret put`。密钥必须长期保留，更换后已有仓库 Token 将无法解密。

#### 3. 应用数据库迁移

本地已登录 Wrangler 时：

```powershell
npm run db:migrate:remote
```

如果改用 Cloudflare Workers Builds，请在 Workers Builds 的 **Deploy command** 中配置远程迁移与部署，详见下文。不要同时在三个平台重复执行同一批迁移。

### 方式一：Cloudflare Workers Builds（推荐）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages**。
2. 选择 **Create application → Continue with GitHub**，授权并选择 `shiguang-vault` 仓库。
3. 选择生产分支 `main`，Worker 名称设为 `shiguang-vault`（或修改 `wrangler.jsonc` 的 `name` 后使用相同名称）。
4. 构建配置：
   - **Build command**：`npm run build`
   - **Deploy command**：`npm run db:migrate:remote && npx wrangler deploy`
5. 在 Worker 的 **Settings → Variables and Secrets** 新增 Secret：`ENCRYPTION_KEY`。不要把值提交到 GitHub。
6. 保存并触发首次构建。构建日志确认迁移成功、Worker 部署成功后，访问 Workers 域名下的 `/setup` 创建管理员密码。
7. 在 **Settings → Domains & Routes** 绑定自定义域名，并启用 HTTPS。

Workers Builds 使用的配置文件仍是仓库中的 `wrangler.jsonc`。若 D1 ID 不能公开，请不要把真实 ID 直接提交到公开仓库；应使用私有部署仓库，或在 Cloudflare 构建环境中生成部署配置。此仓库默认保持占位值，适合先 Fork 到你自己的私有仓库再部署。

### 方式二：GitHub Actions

仓库包含 `.github/workflows/deploy.yml`，只支持 **手动触发**，不会在每次推送时自动发布。工作流会依次执行类型检查、构建、远程数据库迁移和 Worker 部署。

#### 1. 创建 Cloudflare API Token

在 Cloudflare Dashboard 的 **My Profile → API Tokens → Create Token** 创建自定义 Token。至少需要：

- Workers Scripts：Edit
- D1：Edit
- Account Settings：Read（用于定位账号）
- 如使用自定义域名：Workers Routes：Edit

尽量只授权当前 Cloudflare 账号；不要使用 Global API Key。

#### 2. 添加 GitHub Secrets

在 GitHub 仓库进入 **Settings → Secrets and variables → Actions → New repository secret**，添加：

- `CLOUDFLARE_API_TOKEN`：上一步创建的 Token
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Dashboard 右侧概览中的 Account ID

`ENCRYPTION_KEY` 仍保存在 Cloudflare Worker Secret 中，不需要放进 GitHub Actions。

#### 3. 可选：配置 production Environment

工作流使用 `environment: production`。如需人工审批，在 GitHub **Settings → Environments** 创建 `production`，添加 Required reviewers；不创建也可以直接运行。

#### 4. 手动运行

进入 GitHub 仓库 **Actions → Deploy to Cloudflare Workers → Run workflow**，选择 `main` 后执行。首次运行会应用 D1 迁移并部署 Worker。

工作流使用 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 连接 Cloudflare，不会把密钥写进仓库。若 D1 ID 不希望公开，请使用私有部署仓库；公开仓库中的 `wrangler.jsonc` 应继续保留占位值。

### 方式三：本机 Wrangler

已在本机登录并完成 D1 配置时：

```powershell
npm run check
npm run db:migrate:remote
npx wrangler secret put ENCRYPTION_KEY
npm run deploy
```

随后访问 `/setup` 完成管理员初始化，并在 Cloudflare **Settings → Domains & Routes** 绑定自定义域名。

### 部署顺序与常见错误

- **先迁移再部署**：首次部署前必须创建 D1 并应用迁移，否则应用会在访问数据库时失败。
- **Secret 只设置一次**：`ENCRYPTION_KEY` 更换会导致已保存的仓库 Token 无法解密。
- **不要提交真实 D1 ID**：公开仓库应使用占位值；生产部署应使用私有仓库或受控构建环境。
- **域名不是部署必需项**：可先使用 `workers.dev` 验证 `/setup`、上传和分享，再绑定自定义域名。
- **Actions 与 Workers Builds 二选一**：同时启用两套自动部署会造成重复构建和迁移。

## 连接 GitHub

建议使用 Fine-grained Personal Access Token，并遵循最小权限原则：

1. 在 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 创建 Token。
2. Repository access 只选择需要作为媒体存储的私有仓库。
3. 授予 **Contents: Read and write**；通常还需要自动附带的 **Metadata: Read-only**。
4. 在后台「存储库 → 连接 GitHub」填写：
   - 所有者：GitHub 用户名或组织名
   - 仓库名：例如 `media-library`
   - 分支：通常为 `main`
   - 存储子目录：可选，例如 `media`
   - Token：刚创建的访问令牌

可以按主题拆分多个私有仓库，例如图片、音乐或旅行归档，并在后台指定默认上传目标。

## 连接 GitLab 备份

建议创建仅能访问备份项目的 Personal Access Token，并授予仓库读写所需的 `api` 权限。

在后台「存储库 → 连接 GitLab」时，将备份库绑定到一个 GitHub 主仓库。GitLab 备份仓库不会作为新上传目标，也不会在展示页重复出现。

### 自动增量备份

1. 在后台启用 GitLab 备份库后，每次从上传页新增文件，都会在写入 GitHub 后立即尝试备份到所有已绑定的 GitLab 仓库。
2. 备份前会读取 GitLab 备份库的文件树，以**文件名**判断是否已经存在；同名文件直接跳过，不会重复上传或覆盖。
3. 在后台扫描 GitHub 主仓库时，新发现的文件也会自动备份；已有文件只核对状态。
4. 需要补齐历史内容或重试失败项时，可对 GitHub 主仓库执行「全量备份」；它同样按文件名去重。
5. 备份失败不会撤销已完成的 GitHub 上传，失败原因会记录在作品镜像状态和备份仓库卡片中，可修复 Token 或分支后重试。

自动备份在同一请求内完成，不依赖定时任务。首次接入已有仓库时，建议先执行一次全量备份。

## 图片、音乐与分享

### 上传规则

- 图片：JPG、JPEG、PNG、GIF、WebP、AVIF、SVG、BMP、HEIC；单张最大 20 MB。
- 音乐：MP3、M4A、AAC、WAV、FLAC、OGG、OPUS；单首最大 50 MB。
- 文件按类型保存到 `images/` 或 `music/`，并使用中国标准时间的 17 位时间戳命名，例如 `20261025123045123.webp`。
- 不保留原文件名，也不按年月创建目录。

### WebP 优化

- JPG、JPEG、PNG、BMP 会在浏览器端尝试转换。
- 默认质量为 `0.86`，最长边限制为 `4096px`。
- 已为 WebP/AVIF/HEIC 的文件不重复压缩。
- GIF 保留动画；SVG 保留矢量格式。
- 转换失败、输出格式不正确或体积未变小时，自动上传原文件。
- 上传后的时间戳扩展名与实际文件格式一致。

### 分享链接

在图片预览、音乐卡片、曲目表或后台内容库中点击「获取链接」，可生成：

- 直接访问链接：根路径 + 时间戳文件名
- Markdown 图片：`![标题](链接)`
- Markdown 音乐：`[标题](链接)`

默认有效期为「永久」，也可选择 7 天、30 天或 1 年。管理员可以查看并撤销分享。

> 访问分享链接等同于“持有即可查看”。不要把包含私人内容的分享链接发布到公开网页、搜索引擎或社交平台。

旧的 `/share/:token` 链接仍保持兼容。

## 安全与隐私

- 保持 GitHub 与 GitLab 媒体仓库为 **Private**。
- 使用独立且足够强的管理员密码，不要复用其他站点密码。
- 将仓库 Token 仅保存在后台加密配置中，不要写进代码或提交到 Git。
- 不要把 `ENCRYPTION_KEY`、D1 的真实 `database_id`、Cookie、Token 或数据库导出文件提交到仓库。
- 部署后检查公开仓库历史；若曾提交密钥，应立即在 GitHub/GitLab 撤销并重新生成，而不是只删除文件。
- 分享链接应按敏感内容对待，并设置合适有效期。
- 定期检查后台操作记录与失败登录。

## 可直接替换的配置示例

README 只展示占位值。以下内容都不应原样作为真实凭据：

```text
站点地址：https://<your-domain.example>
D1 database_id：<your-d1-database-id>
GitHub 仓库：<owner>/<repository>
GitLab 仓库：<namespace>/<repository>
加密密钥：由密码管理器生成，仅保存为 Worker Secret
管理员密码：首次部署时通过 /setup 设置
```

## 常用命令

```powershell
npm run dev              # 启动本地前端与 Worker
npm run typecheck        # TypeScript 检查
npm run build            # 生产构建
npm run check            # 类型检查与构建
npm run db:migrate:local # 应用本地 D1 迁移
npm run db:migrate:remote  # 应用远程 D1 迁移
npm run deploy           # 构建并部署到 Cloudflare
```

## 上线检查清单

- [ ] 已创建自己的 D1 数据库并替换 `wrangler.jsonc` 占位值
- [ ] 已执行远程数据库迁移
- [ ] 已通过 Worker Secret 设置并备份 `ENCRYPTION_KEY`
- [ ] 已通过 `/setup` 创建独立管理员密码
- [ ] GitHub Token 权限已按最小范围配置
- [ ] GitLab Token 权限已按最小范围配置
- [ ] GitHub 与 GitLab 仓库均为 Private
- [ ] 已验证上传、图片预览、音乐播放和分享链接
- [ ] 已验证撤销分享后的访问行为
- [ ] 已验证新上传自动备份，并确认同名文件会跳过
- [ ] 已绑定自定义域名并确认 HTTPS
- [ ] 已确认仓库中没有真实域名、凭据、D1 ID 或数据库导出
- [ ] 已选定使用 Workers Builds、GitHub Actions 或本机 Wrangler 之一
- [ ] 已按所选部署方式配置 Cloudflare / GitHub 凭据
- [ ] 已确认没有同时启用 Workers Builds 与 GitHub Actions 自动部署

## 参与贡献

欢迎提交 Issue 与 Pull Request。提交前请：

1. 运行 `npm run check`。
2. 不提交 `.dev.vars`、`.env`、`.wrangler`、数据库导出、真实 Token 或私人媒体。
3. 在 Issue 和截图中隐藏域名、用户名、仓库地址、Token 与 D1 ID。
4. 描述可复现步骤，并说明使用的浏览器与运行环境。

## 许可证

本项目以 [MIT License](LICENSE) 开源。
