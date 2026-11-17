# 腾讯云部署与微信扫码

在腾讯云轻量应用服务器 Lighthouse 上采用 Ubuntu 24.04 LTS、Node.js 24 和 systemd。实际部署通过[独立 Hermes Profile](hermes-profile.md)连接微信，使用专用 Linux 用户、状态目录、SQLite 和微信绑定。两种微信网关都使用出站长轮询，云防火墙无需向公网开放端口。 [腾讯云 Linux 实例指南](https://intl.cloud.tencent.com/zh/document/product/1103/41401)

本文第 1 节适用于两种部署。第 2–4 节说明 OpenClaw 路径，验证版本为 OpenClaw `2026.11.4` 和腾讯微信插件 `2.4.10`。每个绑定使用一个网关。 [OpenClaw 发布](https://github.com/openclaw/openclaw/releases/tag/v2026.11.4) · [微信插件发布代码](https://github.com/Tencent/openclaw-weixin/tree/v2.4.10)

## 1. 准备专用服务

在已授权的 Ubuntu 实例核对 Node.js 和 git。已有系统 Node.js 24 可直接使用。若系统版本较低，在创建专用用户并取得源码后，可将 Node.js 24 安装到教练的状态目录，部署脚本优先使用该目录下的版本。该方式需要 curl、tar 和 sha256sum。 [Node.js 官方下载](https://nodejs.org/en/download)

```bash
node -v
sudo useradd --system --user-group --create-home --home-dir /var/lib/road-cycling-coach --shell /bin/bash road-cycling
sudo chmod 700 /var/lib/road-cycling-coach
sudo install -d -m 750 -o road-cycling -g road-cycling /srv/road-cycling-coach
sudo -u road-cycling -H git clone <你的仓库地址> /srv/road-cycling-coach
# 需要私有 Node.js 24 时运行
# sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/install-node.sh
```

选择 Hermes 时，继续执行[独立 Profile 指南](hermes-profile.md)。选择 OpenClaw 时，确认本地端口 `18796` 空闲，然后安装该路径的服务。

```bash
ss -ltn '( sport = :18796 )'
sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/init.sh
sudo install -m 644 /srv/road-cycling-coach/deploy/road-cycling-coach.service /etc/systemd/system/road-cycling-coach.service
sudo systemctl daemon-reload
```

初始化会创建权限为 `0600` 的 `.env`，生成本机回环网关的随机访问令牌，并将新网关配置放到 `/var/lib/road-cycling-coach/openclaw`。SQLite 默认在 `/var/lib/road-cycling-coach/data/coach.sqlite`，运行时在同层的 `runtime`。FIT/CSV 导入、Intervals.icu 同步和 ZWO 导出可使用 `sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/openclaw.sh coach <命令与参数> weixin`，参数见[骑行数据指南](training-data.md)。安装要求访问 npm，微信插件需要访问微信后端。

如果从 ZIP 上传源码，先核对压缩包内容，确保解压后的项目归 `road-cycling` 所有，并对该项目目录执行 `chmod -R go-w`。OpenClaw 会拒绝具有不安全写权限的插件文件。初始化会让 OpenClaw 信任并授权该目录下的教练插件。

## 2. 绑定新教练

在手机微信的 ClawBot 界面创建教练的独立会话，仅在扫码页面明确指向独立绑定时确认。若页面要求替换或解绑其他连接，取消扫码。能否添加独立会话由微信绑定端决定，部署完成后以手机实际看到的教练会话为准。 [腾讯插件扫码说明](https://github.com/Tencent/openclaw-weixin/tree/v2.4.10)

```bash
sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/openclaw.sh channels login --channel openclaw-weixin
sudo systemctl enable --now road-cycling-coach
sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/openclaw.sh channels status --json
sudo journalctl -u road-cycling-coach -n 80 --no-pager
```

扫码并在手机确认后，记录新账号的 account ID。手机从新会话发送一条测试文字，在新服务私有日志中找 `inbound: from=` 取得 peer ID（一般以 `@im.wechat` 结尾）。也可在服务器本地查看状态目录下 `openclaw-weixin/accounts/<account-id>.json` 中的 `userId`，核对它与实际入站一致。等待配置期间教练会忽略该入站指令。

```bash
sudo -u road-cycling -H nano /srv/road-cycling-coach/.env
# 填写 COACH_WEIXIN_ACCOUNT 和 COACH_WEIXIN_PEER
sudo systemctl restart road-cycling-coach
sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/openclaw.sh plugins inspect road-cycling-coach --runtime --json
```

确认插件已注册 `before_dispatch`。从手机发「帮助」验证回复，然后按[验收步骤](acceptance.md)跑几分钟后的提醒和重启测试。教练只处理同时匹配微信通道、account ID、peer ID 的单聊。主动消息显式指定同一绑定和接收人，并调用网关进程内的腾讯插件发送适配器。

## 3. 可选接入 TokenHub Hy4 Flash

教练使用自己的骑手档案、训练计划和反馈。可选模型用于理解灵活表达及润色规则给出的调整原因。

在 TokenHub 控制台开通 Hy4 Flash，为教练生成专用 API key，再编辑教练的 `.env`。广州按量调用的配置如下，其他地域或 Token Plan 使用控制台给出的完整 Chat Completions 地址。模型访问密钥仅填在服务器本地。

```dotenv
COACH_MODEL_URL=https://tokenhub.tencentmaas.com/v1/chat/completions
COACH_MODEL_NAME=hy4-flash
COACH_MODEL_KEY=
```

保存后重启 `road-cycling-coach`。教练对该模型的短指令请求关闭深度思考，避免额外等待。可以先在终端用「把接下来七天的安排发给我」测试模型理解，再从独立微信会话验证；基础指令和主动提醒可在无密钥时运行。真实 TokenHub 账号调用仍待验收。 [TokenHub 接口地址](https://cloud.tencent.com/document/product/1823/130079) · [模型 ID](https://cloud.tencent.com/document/product/1823/130051) · [思考开关](https://cloud.tencent.com/document/product/1823/131208)

## 4. 日常操作

```bash
sudo systemctl start road-cycling-coach
sudo systemctl stop road-cycling-coach
sudo systemctl restart road-cycling-coach
sudo systemctl status road-cycling-coach
sudo journalctl -u road-cycling-coach -f
sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/openclaw.sh coach jobs weixin
```

### 更新

先备份。使用专用用户执行 `git fetch --tags`，检出已审查的提交，运行 `npm test` 后重启。需要更新 OpenClaw 时，在新的测试环境验证两端版本后更新 `deploy/init.sh` 的版本。升级微信插件使用同一包装脚本的 `plugins install <带版本的包名> --force --pin`。每次升级后重跑手机收发及重启用例。

### 备份和恢复

用绝对路径存放备份。压缩包含授权信息、模型或 Intervals.icu 密钥（如配置）、档案和任务，由 root 私有保存。额外记录部署的 Git 提交、Node 和两个插件版本。若自定义了 `COACH_DB`，请同时备份自定义位置。

```bash
sudo systemctl stop road-cycling-coach
sudo bash /srv/road-cycling-coach/deploy/backup.sh /root/road-cycling-coach-backup.tar.gz
sudo systemctl start road-cycling-coach
```

恢复时先停止服务，检查可信归档的条目，保留当前状态的备份，然后在相同目录布局下以 root 解压，确认专用用户及权限，装回对应代码版本后启动。备份时已开始而状态未落盘的发送仍按不确定处理。环境迁移后确认微信授权仍有效，按需重新扫码。

### 会话失效和重新绑定

`session_invalid` 出现时，教练暂停投递并作废已有的待发任务。先从原教练会话发送「帮助」，验证正常回复，随后用新测试提醒验收。仍无法收发时，停止这套网关，使用自己的 `deploy/openclaw.sh channels login --channel openclaw-weixin` 重新扫码，核对 `.env` 中两个 ID 后启动，再发一条入站。若 ID 发生变化，系统视为新的骑手路由，旧档案仍在 SQLite 的旧路由下。绑定成功且手机到达才算恢复。插件的后端会话过期码是 `-14`。其他拒绝或通道成功但手机不可见时，保留任务号和实测间隔，检查插件日志。 [会话保护实现](https://github.com/Tencent/openclaw-weixin/blob/v2.4.10/src/api/session-guard.ts) · [通道成功但手机不可见的社区记录](https://github.com/Tencent/openclaw-weixin/issues/264)

### 提醒和时钟

默认 `Asia/Shanghai`，按当地日期计算每日课前和课后槽位。每种每天最多尝试发送一次，允许在计划点之后约 10 分钟内补跑；已过窗口的提醒或失效期间已经到点的提醒作废。测试提醒独立于训练提醒开关。调度器用 SQLite 唯一键和事务认领，发送等待上限 12 秒。超时或进程中断时标记 `uncertain`，无需自动重发。该版本腾讯 SDK 有自己的请求超时，超时后的 `uncertain` 可能对应一条已发出的消息。通过 `确认收到 <任务号>` 记录手机回执。手机长时间无互动后的成功率按实测留档，后端时效与配额以实际绑定表现为准。
