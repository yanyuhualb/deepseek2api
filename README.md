# DeepSeek2API

> 一个纯 Node.js 的 DeepSeek Web 控制台 + 多协议 API 桥接服务。
> 把本地用户体系、DeepSeek 账号绑定、API Key 管理、原生代理调试和管理后台放进同一个可直接运行的项目里。
> 同时支持 OpenAI、Anthropic、OpenAI Responses 三种 API 格式。

## 功能概览

| 模块 | 能力 |
| --- | --- |
| 控制台 UI | 登录 / 注册、聊天工作区、历史会话、文件上传、主题切换、流式 / 非流式响应切换 |
| DeepSeek 账号层 | 绑定多个 DeepSeek Web 账号，按管理员 / 本地用户隔离可见范围 |
| OpenAI 兼容层 | 提供 `GET /v1/models` 和 `POST /v1/chat/completions` |
| Anthropic 兼容层 | 提供 `POST /v1/messages`，支持 `x-api-key` 鉴权 |
| Responses API 层 | 提供 `POST /v1/responses`，兼容 OpenAI Responses API 格式 |
| 工具调用解析 | 自动识别多种格式的工具调用（XML 标签、代码块、纯文本标记等）并转换为标准格式 |
| 原生代理层 | 提供 `/proxy/*` 白名单转发，便于调试和复用 DeepSeek Web 接口 |
| 调试模式 | 可选的请求追踪与日志记录，敏感信息自动脱敏，可选哈希化对话内容 |
| 管理后台 | 注册开关、邀请码生成 / 删除、用户启用 / 禁用 / 删除、并发 / 速率限制 |
| 无痕模式 | 支持全局或用户级无痕，会话完成后自动清理 |
| 安全特性 | 密码 AES 加密、CORS 白名单、登录限流、上游超时、Cookie Secure、PoW WASM 本地缓存 + 哈希校验 |
| 部署形态 | 无第三方 npm 运行时依赖，`npm start` 即可启动 |

## 项目特点

- 纯 Node.js 原生 HTTP 服务，无 Express、无数据库、无构建步骤
- 前后端都在一个仓库里，静态资源由服务端直接托管
- 运行状态统一保存在 `data/app.json`
- DeepSeek token 失效时会自动重新登录并刷新
- 遇到 PoW 保护接口时会自动获取 wasm 并求解挑战
- 同时支持 OpenAI、Anthropic Messages、OpenAI Responses 三种 API 格式，均支持流式和非流式
- 上游 DeepSeek API 错误会按各 API 格式标准正确传递给客户端
- 工具调用解析支持 `<tool_call`、`<tool_code`、`<invoke`、`<function_call`、`[Called tool:`、代码块等多种格式
- `deepseek-reasoner-*` 模型会把思维内容包裹在 `<think>...</think>`
- API Key 请求会在当前用户可见账号之间轮询，提高多账号利用率
- 可选调试模式，记录请求全链路日志（敏感信息自动脱敏）

## 运行要求

- Node.js 18+
- 服务端能够访问 `https://chat.deepseek.com`
- 浏览器在绑定 DeepSeek 账号时需要访问 `https://cdn.deepseek.com`
- 如触发 PoW 校验，服务端还需要访问 `https://fe-static.deepseek.com`

## 快速开始

### 1) 启动服务

```bash
npm start
```

默认监听地址：

```text
http://127.0.0.1:3000
```

### 2) 可选：创建本地配置

仓库不自带 `.env`。如需启用管理员入口或修改端口，可参考 `.env.example` 手动创建：

```bash
cp .env.example .env
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env
```

`.env.example` 内容：

```env
PORT=3000
DEBUG=true
APP_ADMIN_USERNAME=
APP_ADMIN_PASSWORD=

# 生产环境推荐配置
NODE_ENV=production
SECRET_ENCRYPTION_KEY=
ALLOWED_ORIGINS=
```

### 3) 打开控制台

浏览器访问 `http://127.0.0.1:3000`，然后按下面的典型流程使用：

1. 注册本地用户，或使用管理员账号登录
2. 在“账号”页绑定 DeepSeek 账号
3. 在“密钥”页创建 API Key
4. 使用内置聊天工作区，或通过 OpenAI 兼容接口接入你的客户端

## 环境变量

### 基础

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口 |
| `NODE_ENV` | 空 | 设为 `production` 后启用 Cookie `Secure` 标志、生产错误脱敏 |
| `DEBUG` | `false` | 启用调试模式，记录请求追踪日志 |
| `DEBUG_SANITIZE` | `false` | 调试日志中的对话内容用 SHA-256 摘要替代原文 |
| `TOOL_CALL_MODEL` | 空 | 工具调用使用的模型 ID，留空则使用请求原始模型 |
| `APP_ADMIN_USERNAME` | 空 | 管理员用户名 |
| `APP_ADMIN_PASSWORD` | 空 | 管理员密码 |

只有同时设置 `APP_ADMIN_USERNAME` 和 `APP_ADMIN_PASSWORD` 时，管理员入口才会启用。

### 安全 / 加密

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SECRET_ENCRYPTION_KEY` | 空 | 启用 DeepSeek 账号密码 AES-256-GCM 加密存储；缺失时密码以明文落盘并打印警告 |
| `ALLOWED_ORIGINS` | 空 | CORS 受信源白名单，逗号分隔。生产环境强烈建议显式配置；为空且 `NODE_ENV=production` 时跨域请求将被拒绝 |
| `POW_WASM_SHA256` | 空 | 下载的 PoW WASM 文件 SHA-256 期望值，配置后启用校验 |

### 速率与超时

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | `5` | 登录失败次数上限 |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `60000` | 登录失败计数窗口（毫秒） |
| `LOGIN_RATE_LIMIT_BLOCK_MS` | `900000` | 触发上限后临时封禁时长（毫秒） |
| `UPSTREAM_REQUEST_TIMEOUT_MS` | `30000` | 上游非流式请求超时（毫秒） |
| `UPSTREAM_STREAM_TIMEOUT_MS` | `300000` | 上游流式请求超时（毫秒） |

## 控制台能力

### 聊天工作区

- 查看 DeepSeek 历史会话并加载消息记录
- 新建会话、继续会话、发送消息
- 上传文件并在聊天中引用
- 切换流式 / 非流式响应
- 切换快速 / 专家 / 推理 / 联网模型

### 账号与密钥

- 绑定 / 删除 DeepSeek Web 账号
- 为当前用户创建多个 API Key
- API Key 可指定自定义明文，留空则自动生成
- OpenAI 兼容调用默认使用所选账号起始，并在当前用户可见账号之间轮询

### 管理后台

- 管理本地注册开关
- 控制是否必须使用邀请码注册
- 生成、删除、批量删除邀请码
- 禁用、启用、删除本地用户
- 为用户设置并发上限和每分钟请求上限

### 无痕模式

- 管理员可以开启全局无痕
- 普通用户可以只为自己开启无痕
- 开启后，聊天完成后会自动清理相关 DeepSeek 会话

## 生产部署建议

部署到公网或多用户环境前，建议执行以下检查：

1. 设置 `NODE_ENV=production`：启用 Cookie `Secure` 标志和生产错误脱敏
2. 设置 `SECRET_ENCRYPTION_KEY`（推荐 32 字节以上随机字符串）：将 DeepSeek 账号密码以 AES-256-GCM 加密落盘
3. 设置 `ALLOWED_ORIGINS=https://your-domain.com`：避免任意源跨域读取认证响应
4. 通过 HTTPS 反向代理（Nginx / Caddy）暴露服务，避免 cookie 在明文链路上传输
5. 如果对外暴露 `/api/auth/login`，可调小 `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` 或调大 `LOGIN_RATE_LIMIT_BLOCK_MS`
6. 启用 `DEBUG` 时同时设置 `DEBUG_SANITIZE=true`，避免完整对话内容落盘
7. 可选：下载 `https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm` 计算其 SHA-256，设置到 `POW_WASM_SHA256` 启用校验

> 现有 `data/app.json` 内的明文密码会在下一次 token 刷新或账号更新时自动加密；如希望立即迁移，可重新绑定一次账号。

## API 兼容接口

### 支持的接口

| 接口 | 方法 | 协议格式 |
| --- | --- | --- |
| `/v1/models` | GET | OpenAI |
| `/v1/chat/completions` | POST | OpenAI Chat Completions |
| `/v1/responses` | POST | OpenAI Responses |
| `/v1/messages` | POST | Anthropic Messages |

### 鉴权方式

- OpenAI 格式（`/v1/models`、`/v1/chat/completions`、`/v1/responses`）：`Authorization: Bearer <API_KEY>`
- Anthropic 格式（`/v1/messages`）：`x-api-key: <API_KEY>` 或 `Authorization: Bearer <API_KEY>`

### 请求示例

```bash
curl http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer <YOUR_API_KEY>"
```

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat-fast",
    "messages": [
      { "role": "user", "content": "hello" }
    ],
    "stream": false
  }'
```

### 模型说明

- 默认模型：`deepseek-chat-fast`
- 联网能力通过模型后缀 `-search` 控制
- 不支持 `web_search_options`；请改用 `*-search` 模型

<details>
<summary>展开查看支持的模型 ID</summary>

- `deepseek-chat-fast`
- `deepseek-chat-fast-search`
- `deepseek-reasoner-fast`
- `deepseek-reasoner-fast-search`
- `deepseek-chat-expert`
- `deepseek-chat-expert-search`
- `deepseek-reasoner-expert`
- `deepseek-reasoner-expert-search`
- `deepseek-v4-flash`
- `deepseek-v4-flash-search`
- `deepseek-v4-reasoner-flash`
- `deepseek-v4-reasoner-flash-search`
- `deepseek-v4-pro`
- `deepseek-v4-pro-search`
- `deepseek-v4-reasoner-pro`
- `deepseek-v4-reasoner-pro-search`

</details>

## 原生代理接口

### 支持的接口

- `GET /proxy/...`
- `POST /proxy/...`

### 使用说明

- `/proxy/*` 走的是登录态会话，不是 API Key 鉴权
- 如果存在多个可用账号，可通过请求头 `x-proxy-account-id` 指定账号
- 只允许转发白名单路径，白名单定义在 `src/config.js`

<details>
<summary>展开查看当前白名单路径</summary>

- `/api/v0/chat/completion`
- `/api/v0/chat/continue`
- `/api/v0/chat/create_pow_challenge`
- `/api/v0/chat/edit_message`
- `/api/v0/chat/history_messages`
- `/api/v0/chat/message_feedback`
- `/api/v0/chat/regenerate`
- `/api/v0/chat/resume_stream`
- `/api/v0/chat/stop_stream`
- `/api/v0/chat_session/create`
- `/api/v0/chat_session/delete`
- `/api/v0/chat_session/delete_all`
- `/api/v0/chat_session/fetch_page`
- `/api/v0/chat_session/update_pinned`
- `/api/v0/chat_session/update_title`
- `/api/v0/client/settings`
- `/api/v0/download_export_history`
- `/api/v0/export_all`
- `/api/v0/file/fetch_files`
- `/api/v0/file/preview`
- `/api/v0/file/upload_file`
- `/api/v0/share/content`
- `/api/v0/share/create`
- `/api/v0/share/delete`
- `/api/v0/share/fork`
- `/api/v0/share/list`
- `/api/v0/users`
- `/api/v0/users/settings`
- `/api/v0/users/update_settings`

</details>

## 本地接口总览

<details>
<summary>展开查看完整接口清单</summary>

### 公共接口

- `GET /api/me`
- `GET /api/discovery`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/logout`

### 登录后接口

- `GET /api/accounts`
- `POST /api/accounts`
- `DELETE /api/accounts/:id`
- `POST /api/incognito`
- `GET /api/api-keys`
- `POST /api/api-keys`
- `DELETE /api/api-keys/:id`

### 管理接口

- `POST /api/admin/registration`
- `POST /api/admin/invites`
- `POST /api/admin/invites/batch-delete`
- `DELETE /api/admin/invites/:id`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `POST /api/admin/users/batch-disable`
- `POST /api/admin/users/batch-delete`

</details>

## 项目结构

```text
.
├─ data/                  # 运行时数据目录（app.json、wasm 缓存等）
├─ logs/                  # 调试日志目录（启用 DEBUG 时生成）
├─ public/                # 前端控制台静态资源
│  └─ html-escape.js      # 共享 HTML 转义工具
├─ src/
│  ├─ routes/             # 公共 / 私有 / 管理 / 代理 / v1 路由
│  ├─ services/           # 账号、用户、桥接、PoW、限流等核心逻辑
│  │  ├─ openai-bridge.js          # OpenAI Chat Completions 桥接
│  │  ├─ anthropic-bridge.js       # Anthropic Messages 桥接
│  │  ├─ responses-bridge.js       # OpenAI Responses API 桥接
│  │  ├─ completion-core.js        # 流式处理与工具调用检测公共逻辑
│  │  ├─ login-rate-limit-service.js  # 登录速率限制
│  │  └─ request-limit-service.js  # 用户级并发 / 频率限制
│  ├─ storage/            # JSON 文件存储（原子 rename 写入）
│  └─ utils/
│     ├─ tool-prompt.js         # 工具调用多格式解析
│     ├─ debug-logger.js        # 调试日志与请求追踪
│     ├─ deepseek-sse.js        # DeepSeek SSE 解码器
│     ├─ secret-cipher.js       # AES-256-GCM 密码加密
│     ├─ fetch-with-timeout.js  # 上游 fetch 超时封装
│     ├─ prompt.js              # 系统提示词生成
│     └─ http.js, id.js         # HTTP、ID 工具
├─ .env.example
├─ package.json
└─ README.md
```

## License

This project is licensed under the [MIT License](./LICENSE).

[原仓库](https://github.com/TQZHR/deepseek2api)
