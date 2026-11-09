# DeepSeek模型接入

2026-11-09按官方文档及账号模型列表接入 `deepseek-flash`。该模型是当前官方Flash模型名；不要使用旧示例中的过期模型名称。

本项目继续使用自己的JSON动作循环和本地执行工具，通过OpenAI兼容的Chat Completions协议调用DeepSeek，没有接入新的Agent SDK或替换harness。

## 本机配置

```dotenv
LLM_API_KEY=填写自己的密钥
LLM_MODEL=deepseek-flash
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_PATH=/chat/completions
LLM_THINKING_MODE=disabled
LLM_JSON_OUTPUT=true
WQ_DEMO_FALLBACK=false
```

真实值只放本机`.env`及被忽略的生产配置目录；不写前端变量、不上传Git/Vercel。`LLM_*`优先于旧`WQ_*`配置，旧配置仅在本地私有备份中用于人工回退。已有账号、输入、历史和图表保持。

DeepSeek思考模式默认开启。本次显式关闭，模型直接返回动作JSON，适配现有单轮输出额度。JSON输出设置`response_format.type=json_object`，提示中仍必须说明JSON结构。普通工具动作保持1000-token额度，政策解析使用6000-token与60秒超时。

政策提示词明确区分“多个客户分层”与“每分层内部一档/二档”，要求提取全部客户类型与base区间；缺失规则仍需澄清，不猜测。

UI的模型来源继续使用已有`openai-compatible`标识，显示在线模型。接口报错按实际供应商显示，处理DeepSeek的`error.message`并遮蔽密钥；限流使用既有限重试机制。

生产模型配置位于`runtime-data/local-host/config.json`，修改后需使用本机托管脚本重载服务。前端仍在Vercel，后端和历史存储仍依赖电脑在线。

## 官方依据

- [首次调用API](https://api-docs.deepseek.com/zh-cn/)
- [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
- [JSON输出](https://api-docs.deepseek.com/zh-cn/guides/json_mode)

实际验证覆盖模型列表、JSON输出、金额合计300及绘图/历史副本、模拟政策8分层抽取与政策工具ROI。代码回归检查接口参数、密钥遮蔽及429重试信息。
