# DB Archaeologist Web GUI

基于 PI RPC 模式的 Web 前端，提供对话界面、模型/思考等级切换、历史会话管理。

## 快速启动

### 1. 本地访问（默认）

```bash
cd /path/to/db-archaeologist-pi-spec-pack
node web/server.mjs
```

访问：http://127.0.0.1:4318

### 2. 局域网访问

```bash
# 设置环境变量监听所有网卡
HOST=0.0.0.0 node web/server.mjs
```

访问：http://\<本机IP\>:4318

查看本机 IP：
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### 3. 自定义端口

```bash
PORT=8080 node web/server.mjs
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `0.0.0.0` | 监听地址（`0.0.0.0` = 所有网卡，`127.0.0.1` = 仅本机） |
| `PORT` | `4318` | HTTP 端口 |
| `PI_DEFAULT_MODEL` | `aicodemirror/gpt-5.5` | 默认模型 |
| `PI_DEFAULT_THINKING` | `auto` | 默认思考等级 |
| `SPEC_PACK_ROOT` | `../` | 项目根目录（自动检测） |

## 架构

- **BFF**：`web/server.mjs`（单进程 Node HTTP 服务器）
  - 静态文件托管：`web/public/`
  - SSE 长连：`/api/stream`
  - RPC 透传：`/api/prompt`、`/api/new_session` 等
  - 会话管理：`/api/sessions/list`（GET）、`/api/sessions/messages`（POST）
- **PI 子进程**：`rpc-bridge.mjs` spawn `/opt/homebrew/bin/pi --mode rpc`
- **前端**：原生 JS（无构建）+ Tailwind CDN

## 功能

- ✅ 对话界面（流式响应 + 工具调用可视化）
- ✅ 模型/思考等级切换
- ✅ 历史会话列表（最近 20 条）
- ✅ 会话切换与恢复
- ✅ 新建会话
- ✅ 资产卡展示（API/Tool/Domain）
- ✅ Registry 快照查看

## 安全说明

- 当前无认证机制，局域网部署时注意访问控制
- PI 会话文件存储在 `~/.pi/agent/sessions/`（单用户）
- 不要在公网暴露此服务

## 故障排查

### Cursor 终端无法启动服务器

症状：`listen EPERM` 或端口占用但无响应

解决：在**外部终端**（非 Cursor）启动服务器

### 历史会话列表为空

检查：
```bash
ls ~/.pi/agent/sessions/
```

如果目录不存在，先运行一次 `pi` 生成会话文件。

### 跨设备访问失败

1. 确认 `HOST=0.0.0.0` 已设置
2. 检查防火墙是否允许入站连接（端口 4318）
3. 确认同一局域网（ping 测试）