# DB Archaeologist Web GUI

基于 PI RPC 模式的 Web 前端，提供对话界面、模型/思考等级切换、历史会话管理。

## 快速启动

### 1. 启动服务（默认支持局域网访问）

```bash
cd /path/to/db-archaeologist-pi-spec-pack
npm run web
```

本机访问：http://127.0.0.1:4318
局域网访问：http://\<本机IP\>:4318

### 2. 仅本机访问

```bash
# 只监听 localhost，局域网不可访问
HOST=127.0.0.1 npm run web
```

查看本机 IP：
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### 3. 自定义端口

```bash
PORT=8080 node web/server.mjs
```

## 服务器部署

推荐在服务器上 clone/copy 完 `PI_AGENT` 后，直接运行 spec-pack 根目录的安装脚本：

```bash
cd /path/to/PI_AGENT/db-archaeologist-pi-spec-pack
chmod +x ./install.sh
./install.sh --host 0.0.0.0 --port 4318 --pi-bin /usr/local/bin/pi
```

脚本会做这些事：

- 检查 Node 版本（要求 Node ≥ 22.6）
- 生成或补齐 `db-archaeologist-pi-spec-pack/.env`
- 创建 `PI_CODING_AGENT_DIR` 对应的 `.pi-home/agent`
- 运行 `node web/_smoke.mjs`
- 如果服务器支持 systemd，则安装并启动 `db-arch-web.service`

常用参数：

```bash
./install.sh --host 127.0.0.1 --port 4318      # 只给本机/Nginx 反代访问
./install.sh --no-systemd                      # 只生成 .env，不安装服务
./install.sh --no-start                        # 安装服务但不立即启动
./install.sh --service-name db-arch-web-test   # 自定义 systemd 服务名
./install.sh --force-env                       # 备份并重写 .env
```

安装后先编辑 `.env`，不要把真实密钥提交进仓库：

```bash
vim .env
```

至少确认这些项：

```dotenv
HOST=0.0.0.0
PORT=4318
PI_BIN=/usr/local/bin/pi
PI_CODING_AGENT_DIR=/path/to/PI_AGENT/db-archaeologist-pi-spec-pack/.pi-home/agent
PI_DEFAULT_MODEL=aicodemirror/gpt-5.5
AICODEMIRROR_API_KEY=
LIVE_PROBE=false
```

需要真实 API 探活时再设置：

```dotenv
LIVE_PROBE=true
ZICHEN_BASE_URL=
ZICHEN_HOST=
ZICHEN_TENANT_ID=
ZICHEN_USER_ID=
ZICHEN_APP_CODE_KEY=
ZICHEN_APP_CODE=
```

systemd 操作：

```bash
sudo systemctl restart db-arch-web
sudo systemctl status db-arch-web --no-pager
sudo journalctl -u db-arch-web -f
```

如果不使用 systemd，可以手动启动：

```bash
cd /path/to/PI_AGENT/db-archaeologist-pi-spec-pack
set -a
. ./.env
set +a
node web/server.mjs
```

### Nginx 反向代理（可选）

公网部署建议让服务只监听 `127.0.0.1`，再由 Nginx 暴露 HTTPS：

```nginx
server {
  listen 80;
  server_name example.com;

  location / {
    proxy_pass http://127.0.0.1:4318;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
  }
}
```

如果直接局域网访问，确认防火墙开放端口：

```bash
sudo ufw allow 4318/tcp
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `0.0.0.0` | 监听地址（`0.0.0.0` = 所有网卡，`127.0.0.1` = 仅本机） |
| `PORT` | `4318` | HTTP 端口 |
| `PI_DEFAULT_MODEL` | `aicodemirror/gpt-5.5` | 默认模型 |
| `PI_DEFAULT_THINKING` | 空 | 默认 thinking level；可设 `off/minimal/low/medium/high` |
| `PI_BIN` | `pi` | pi 可执行文件路径；服务器上可设为 `/usr/local/bin/pi` |
| `PI_CODING_AGENT_DIR` | `.pi-home/agent`（建议） | pi 会话/运行状态目录 |
| `LIVE_PROBE` | `false` | 是否允许真实出站 API 探活 |
| `SPEC_PACK_ROOT` | `../` | 项目根目录（自动检测） |

## 架构

- **BFF**：`web/server.mjs`（单进程 Node HTTP 服务器）
  - 静态文件托管：`web/public/`
  - SSE 长连：`/api/stream`
  - RPC 透传：`/api/prompt`、`/api/new_session` 等
  - 会话管理：`/api/sessions/list`（GET）、`/api/sessions/messages`（POST）
- **PI 子进程**：`rpc-bridge.mjs` spawn `${PI_BIN:-pi} --mode rpc`
- **前端**：原生 JS（无构建）+ Tailwind CDN

## 功能

- ✅ 对话界面（流式响应 + 工具调用可视化）
- ✅ 模型/思考等级切换
- ✅ 历史会话列表（最近 20 条）
- ✅ 会话切换与恢复
- ✅ 新建会话
- ✅ 资产卡展示（API/Tool/Domain）
- ✅ Registry 快照查看
- ✅ Keyword 面板：输入任意品类名称，运行 `baseline_v1` 关键词需求分析，查看 KDS TOP 总榜、按需求类型 TOP、蓝海辅助榜

## 关键词分析前端验收

1. 在外部终端启动服务：

```bash
cd /Users/yichen/Desktop/OntologyBrain/PI_AGENT/db-archaeologist-pi-spec-pack
HOST=127.0.0.1 PORT=4318 node web/server.mjs
```

2. 打开 http://127.0.0.1:4318
3. 右侧 Inspector 点击 `Keyword`。
4. 在“品类名称”输入 `客厅地毯` 或任意其他品类名，保持 `baseline_v1`，不要勾选 `live`，点击“运行分析”。
5. 验收页面出现：
   - `Analysis result`
   - `KDS TOP 总榜`
   - `按需求类型 TOP`
   - `fixture fallback`（当输入品类无本地 fixture 时）
6. 点击“刷新”，下方 `Keyword runs` 能看到刚生成的 run；点击“查看”能看到 `run_summary.md`。

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
2. 如果用了 `HOST=127.0.0.1 npm run web`，改回 `npm run web`
3. 检查防火墙是否允许入站连接（端口 4318）
4. 确认同一局域网（ping 测试）

### systemd 启动后前端可打开但对话不可用

1. 查看日志：`sudo journalctl -u db-arch-web -n 200 --no-pager`
2. 确认 `.env` 中的 `PI_BIN` 可执行：`which pi` 或直接运行 `$PI_BIN --version`
3. 确认 `AICODEMIRROR_API_KEY` 已配置
4. 修改 `.env` 后必须重启：`sudo systemctl restart db-arch-web`

### `.env` 的 HOST/PORT 不生效

确认使用的是最新代码。`web/server.mjs` 会在读取 `HOST/PORT` 前加载 `db-archaeologist-pi-spec-pack/.env`；如果用 systemd，则也会通过 `EnvironmentFile=.env` 注入。
