# 使用个人电脑提供公网访问

## 结构

公网浏览器 → Cloudflare HTTPS隧道 → 本机127.0.0.1:5310 → SaleScope Node服务 → 本机当前网络可访问的模型。
无需公网IP或路由器端口转发，只开放这个应用；模型密钥、用户输入和复盘保存在本机。
访问应用需要账号密码，每个账号的数据目录分开。

电脑要保持开机和联网。脚本通过caffeinate在应用运行时防止闲置休眠，手动休眠、合盖、断网或关机仍会中断访问。
这适合初期试用，不提供云服务器级别的持续可用性保证。

## 当前工作台启动

需要Node.js 22、Python 3、cloudflared，以及已登录GitHub的Git客户端。
首次启动读取本机项目.env中的模型配置，保存在被Git忽略的runtime-data/local-host目录；不会复制客户表。

```bash
node scripts/local-host.mjs start
node scripts/local-host.mjs status
```

首次自动生成owner账号，密码只存本机 `runtime-data/local-host/credentials.txt`。
不要将这个文件、users.json、config.json、server.env上传GitHub或发送到公共群。
临时入口使用随机trycloudflare.com域名；隧道重启后地址可能变化。确定正式域名后，可改为Cloudflare命名隧道及固定域名。

## Git更新

后台每60秒检查已授权仓库main分支。有新提交时：

1. 归档Git提交到独立发布目录；不直接修改正在运行的版本。
2. 安装锁定依赖，执行行为测试、V1快照检查和生产构建。
3. 验证通过后切换本机服务；启动失败时尝试恢复上一发布。
4. 保留同一个隧道和账号数据目录。

Git副本存在未提交修改时拒绝自动部署，不强制覆盖开发代码。构建失败时保留原服务；切换时可能短暂不可访问。
也可以手动触发：

```bash
node scripts/local-host.mjs update
```

推送更新前，使用scripts/sync-github-export.mjs把白名单源码同步到Git副本，检查和提交后推送main。
主分支只应合并你信任的代码；电脑会执行该仓库的构建和测试脚本。

## 添加账号与模型配置

密码从隐藏终端输入，并通过create-user脚本添加到runtime-data/local-host/users.json。
修改本机config.json中的模型字段或users.json后执行：

```bash
node scripts/local-host.mjs restart
```

restart重新加载账号与模型配置，保持当前隧道地址；不会重置客户数据。

## 停止

```bash
node scripts/local-host.mjs stop
```

停止应用、隧道和自动更新，数据保留。电脑重启后需重新start；当前没有安装系统登录启动项。
正式域名和持续运行策略应在验证公网入口后再配置。
