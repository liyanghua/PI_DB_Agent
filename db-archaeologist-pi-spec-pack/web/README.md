# DB Archaeologist · 数仓 API/Tools 助手 · Web GUI

零安装单进程 Web 前端。Node builtins + Tailwind CDN，没有 npm install。

## 形态

```
浏览器 ──SSE──▶  Node http  ──spawn──▶  pi --mode rpc
                  │                        │
                  └ /api/registry          └ .pi/extensions/db_archaeologist
                       ▲                        │
                       └ 读 registry/derived/* ─┘
```

- 三栏布局：Sessions / Conversation / Inspector
- AI-native：thinking、tool calls、tool results、tokens/cost 在同一卡片里实时流出
- ⌘K 命令面板，预置 6 个工具的快捷问句
- Extension UI（select / confirm / input / editor）原生弹窗回写

## 使用

需要先确保：
1. spec-pack 根 `.env` 已配 provider key（例：`AICODEMIRROR_API_KEY=…`）
2. `pi --list-models` 能看到目标模型
3. `npm run build:all` 至少跑过一次（前端 Inspector 会读 `registry/derived/*`）

启动：

```bash
cd db-archaeologist-pi-spec-pack
npm run web                                  # 默认 http://127.0.0.1:4317
PI_DEFAULT_MODEL=aicodemirror/gpt-5.5 npm run web
PI_DEFAULT_MODEL=anthropic/claude-sonnet-4-5 PI_DEFAULT_THINKING=medium npm run web
```

环境变量（都可选）：

| 变量 | 默认 | 说明 |
| - | - | - |
| `PORT` | 4317 | http 监听端口 |
| `HOST` | 127.0.0.1 | 监听地址，默认本机 |
| `PI_BIN` | `pi` | pi CLI 可执行路径 |
| `PI_DEFAULT_MODEL` | 空 | 启动时透传给 `pi --mode rpc --model` |
| `PI_DEFAULT_THINKING` | 空 | `off|minimal|low|medium|high` |
| `SPEC_PACK_ROOT` | 自动 | 强制 pi 子进程的 cwd（默认就是 spec-pack 根） |

server 启动时会尝试 source `<spec-pack-root>/.env` 与 `web/.env`。

## 验收三问

打开 `http://127.0.0.1:4317`：

1. 顶栏显示 model / thinking / pid，左下连接灯绿。
2. 输入「商品诊断有哪些接口？」，2s 内出 thinking → tool card → markdown answer。Inspector 实时显示 timeline、tokens、cost、tool 计数。
3. 中断按钮 1s 内停 streaming；新会话清空状态；⌘K 选「list_domain_apis · 商品域」会预填一个完整 prompt。

## 协议

后端把 pi 的 stdout JSONL 包成 SSE：

| event | data |
| - | - |
| `hello` | 首次连接的握手（含 bridge 状态） |
| `ready` | pi 子进程 spawn 完成，含 pid / cwd / model |
| `agent_event` | pi 的 `AgentSessionEvent`，前端按 `payload.type` 分发 |
| `rpc_response` | RPC 命令 ack（前端只在调试时关心） |
| `ext_ui_request` | 扩展 UI 请求（select/confirm/...），前端弹窗后 POST `/api/ext_ui_response` |
| `stderr` | pi 的 stderr，调试用 |
| `exit` | pi 退出 |
| `heartbeat` | 每 15s 一次防中间代理断流 |

POST 端点都是 RPC 透传：`/api/prompt`、`/api/abort`、`/api/new_session`、`/api/switch_session`、`/api/set_model`、`/api/set_thinking`、`/api/get_state`、`/api/get_session_stats`、`/api/ext_ui_response`。

GET：`/api/health`（bridge 状态）、`/api/registry`（registry/derived 快照）、`/api/stream`（SSE）。

## 不做项

- 不内嵌编辑器；这是助手，不是 IDE
- 不做账号/协作；MVP 单机 single-user
- 不直接调 OpenAI/Anthropic SDK；engine 一律走 `pi --mode rpc`
- 默认绑 127.0.0.1，远程使用请自行加反代

## 离线自检

无需启动 http server，直接跑：

```bash
node web/_smoke.mjs
```

会校验三件事：`registry/derived/*` 快照能解析；markdown 渲染器输出符合预期；事件总线能从 `ready → turn_start → thinking_delta → tool_execution_end → text_end → turn_end` 完整推到一个 done 的 assistant turn。