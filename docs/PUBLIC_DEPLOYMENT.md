# SaleScope 公网部署与Git更新

## 部署结构

浏览器 → Caddy HTTPS（80/443）→ Node.js生产服务（容器内部3000）→ 公网模型接口。
Python仅用于读取Excel。前后端同域，不需要把API密钥放进前端。
用户使用浏览器账号密码提示登录；每个账号的政策输入、复盘、图表和评测结果独立存储。
账号相同的不同浏览器共享该账号数据。模型请求最长180秒；同一账号写操作串行，总并发可配置。

建议初期使用Ubuntu 24.04、amd64架构、2核4GB的公网服务器，安装Docker Engine和Compose V2。
需要一个域名解析到服务器公网IP，开放80/443供访问、22仅用于部署SSH。服务器采购与费用需由你确认。
生产服务拒绝空账号配置，不把当前本机客户表自动上传服务器。

## 首次服务器配置

1. 在服务器创建应用目录，例如 `/opt/salescope`，部署SSH用户应能写入目录并运行Docker。
2. 将仓库 `deploy/.env.production.example` 复制为 `/opt/salescope/.env.production`。
3. 填写真实域名、邮箱、`PUBLIC_ORIGIN=https://真实域名` 和公网模型接口配置。`LLM_BASE_URL`填写版本根地址，例如 `https://服务域名/v1`；程序追加`LLM_API_PATH`，不要重复填写`/chat/completions`。
4. 用脚本生成账号密码哈希，写入 `AUTH_USERS_JSON`；不要写明文密码。

在可信终端执行（密码隐藏输入，不能粘贴到聊天记录）：

```bash
read -rs -p '账号密码（至少12字符）：' account_password
printf '%s' "$account_password" | node scripts/create-user.mjs alice auth-users.json
unset account_password
```

将 `auth-users.json` 中的JSON写入服务器 `.env.production` 的 `AUTH_USERS_JSON=` 后，多个用户重复运行脚本添加。
`auth-users.json` 和 `.env.production` 不进入Git，文件权限设为600。

## GitHub配置

仓库 **Settings → Secrets and variables → Actions**：

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | SSH_HOST | 公网服务器IP或域名 |
| Secret | SSH_PORT | SSH端口，默认22 |
| Secret | SSH_USER | 专用部署用户 |
| Secret | SSH_KEY | 部署专用SSH私钥 |
| Secret | SSH_KNOWN_HOSTS | 从可信渠道核验的服务器公钥记录 |
| Variable | APP_DIR | `/opt/salescope` |
| Variable | DEPLOY_ENABLED | 首次配置和模型连通确认后设为`true` |

不要关闭SSH主机校验。密钥只授予本人服务器部署权限；不要把私钥放入仓库或聊天。
启用前提交代码只运行验证，不会尝试连接未知服务器。

## 自动更新

推送 `main` 或手动运行 **Verify and deploy SaleScope**：

1. 安装锁定依赖、运行行为测试和快照检查、构建前端及Docker镜像。
2. 创建私有GHCR镜像，镜像标签是完整Git提交SHA。
3. SSH上传此提交的Compose和Caddy配置；临时令牌拉取私有镜像，拉取后清理令牌。
4. 启动服务并验证容器健康，以及真实模型接口能返回内容；失败时尝试恢复上一镜像和配置。
5. Caddy自动申请HTTPS证书。应用数据和证书放持久卷，代码更新不会覆盖客户输入。

部署成功后仍需从公网验证：首页登录、双账号隔离、CSV/XLSX导入、真实模型、图表、导出。
`/api/health`公开返回服务状态，不能代替真实模型连通测试。公网模型密钥只保存在服务器环境文件。

## 回退

在服务器执行上一发布目录中的脚本：

```bash
bash /opt/salescope/releases/某次提交SHA/rollback.sh /opt/salescope
```

回退镜像与配置，不回退业务输入。初次上线没有上一版本可退；部署失败会返回非零退出状态。
不要运行`docker compose down -v`，这会删除业务数据卷和证书卷。
升级前可做持久卷备份；这套初期方案是单服务器，不具备多节点容灾。

## 当前开发目录与Git目录

当前开发根目录是工作台；Git仓库在 `releases/salescope-ai-github`。
使用 `node scripts/sync-github-export.mjs` 将白名单源码、部署文件和公开说明同步到Git副本，检查差异后提交。
原始Excel、policy-data、policy-reports、本机.env与登录缓存不会同步。
V1继续以SNAPSHOT.json固定，不修改历史快照。
