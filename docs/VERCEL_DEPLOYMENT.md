# Vercel部署

本方案将React/Vite前端部署在Vercel，通过HTTPS重写将`/login`、`/auth/*`、`/api/*`和`/charts/*`请求交给现有本机后端。
万擎、Python读取Excel、用户数据和报告继续在电脑运行及存储；前端部署到Vercel不代表后端已经脱离电脑。

## 配置

`vercel.json`中：

- framework=Vite，outputDirectory=dist。
- 云端安装使用scripts/install-public-deps.mjs，转换公开依赖下载域名但保留integrity。
- 构建开启VITE_REQUIRE_AUTH；未登录会进入网页登录页。
- 重写目标只包括目前已运行的本机HTTPS隧道，不包含模型密钥或用户密码。

部署使用Git副本`releases/salescope-ai-github`，其中没有真实客户输入和密钥。`.vercelignore`进一步排除运行时目录。

## 账号与Git

先通过Vercel CLI登录本人账号，然后创建/关联项目，再连接`bobby6655/salescope-ai`仓库。
GitHub连接可能需要本人授权Vercel GitHub应用访问这个私有仓库。main作为生产分支，后续提交由Vercel构建和部署。
不自动购买或升级付费计划；账号计划、额度与部署保护以实际控制台为准。

## 登录来源

上线的Vercel生产地址，以及接入完成的自定义域名，需要加入本机PUBLIC_ORIGIN_ALIASES明确来源列表。
使用scripts/add-public-origin.mjs添加，再重启本机服务；只允许明确的Vercel地址或bobbyyang.online域名，不允许通配符。
来源配置不替代账号验证，所有分析/图表/报告仍通过后端会话鉴权。

## 域名

已将bobbyyang.online加入Vercel项目，正式登录地址为https://bobbyyang.online/login；备用地址为https://bobbyyang-salescope.vercel.app/login。DNS继续在Spaceship管理，无需为此前的Cloudflare方案更换名称服务器。
具体A/CNAME/TXT记录以Vercel对该项目实际返回的配置为准；不要照抄旧IP。

2026-10-30接入时，Spaceship根域名的两条A记录为216.198.79.1和64.29.17.1，Host均为@。Vercel验证DNS正确后，初次HTTPS握手仍失败；使用Vercel托管证书签发命令完成证书配置后，HTTPS登录页与实际浏览器登录、错误提示、刷新、退出和390px检查通过。后续记录建议以Vercel当前返回值为准。

public-check.yml支持上述两个固定域名和临时隧道，通过GitHub外部网络验证HTTPS、health200、匿名会话401及登录页200，不需要上传应用凭证。

## 运行限制

电脑断网、休眠或本机服务停止时，Vercel静态前端可能仍能打开，但登录和分析不可用。
当前后端是临时trycloudflare地址，重启隧道可能改变地址；变化后重新生成vercel.json、同步Git并部署。
如需完全云端托管，需要另行迁移模型网络接入、Python解析和持久存储。当前没有完成这部分迁移。
