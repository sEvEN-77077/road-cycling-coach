# 使用独立 Hermes Profile 接入微信

教练的 Hermes 入口用一个空白 Profile 接入独立的微信账号。它的配置、凭据、会话与记忆保存在专用 Linux 用户的目录。微信入站由 Hermes 的 `post_gateway_admission` 钩子传给本地教练规则。提醒通过 `hermes send --to weixin` 发到该 Profile 配置的 `WEIXIN_HOME_CHANNEL`。每次发送前校验绑定账号、目标和私聊白名单。两条路径与模拟模式使用同一份课程、活动和提醒逻辑。 [Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles) · [入站钩子](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks) · [微信设置](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin)

## 初始化空白 Profile

按[腾讯云部署指南](tencent-cloud.md)准备专用 Linux 用户、源码目录和 Node.js 24。为该用户独立安装 Hermes CLI，入口为 `/var/lib/road-cycling-coach/.local/bin/hermes`。运行时须支持 `post_gateway_admission` 和 `hermes send --json`。以该用户在 Hermes 源码目录激活 Hermes 的 Python，执行 `python -c "import pm; pm.sync_venv(['messaging'], explicit=True)"`，安装微信适配器依赖和终端二维码渲染。初始化使用 `profile create --no-credentials`，并限制进程环境及 HOME。 [Hermes 安装](https://hermes-agent.nousresearch.com/docs/getting-started/installation) · [Weixin 设置](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin)

```bash
sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/init-hermes.sh
sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/hermes.sh gateway setup
```

设置界面选择 Weixin，用给教练准备的微信账号扫二维码。手机确认出现独立的教练会话后，选择 `Only allow listed user IDs` 并核对默认用户是本次扫码账号，群聊保持关闭。若手机提示会替换其他已有连接，退出本次绑定。运行脚本固定使用 `/var/lib/road-cycling-coach/.hermes/profiles/road-cycling`，初始化脚本启用此 Profile 的独立网关，并为训练处理钩子设置超时。

设置向导询问是否使用本次扫码账号作为 home channel 时选「是」。在这个 Profile 自己的 `.env` 核对 `WEIXIN_DM_POLICY=allowlist`、`WEIXIN_GROUP_POLICY=disabled`，以及 `WEIXIN_ALLOWED_USERS` 与 `WEIXIN_HOME_CHANNEL` 均等于扫码账号的唯一 peer ID。也可以在该文件中补填 home channel。在教练项目的 `.env` 填写这次授权的 `COACH_WEIXIN_ACCOUNT` 与同一个 `COACH_WEIXIN_PEER`，以便规则数据与定时任务按路由保存。Hy4 Flash 开关和独立密钥也在教练项目自己的 `.env` 配置。 [微信权限说明](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin)

## 启动与日志

每个绑定只运行一个微信网关。选择 Hermes 路径时，运行以下两个教练单元。

```bash
sudo install -m 644 /srv/road-cycling-coach/deploy/road-cycling-hermes.service /etc/systemd/system/
sudo install -m 644 /srv/road-cycling-coach/deploy/road-cycling-reminders.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now road-cycling-hermes road-cycling-reminders
sudo journalctl -u road-cycling-hermes -u road-cycling-reminders -f
```

先在手机发送「帮助」，再发送「测试提醒 3 分钟」。等待提醒期间不发消息，收到后用提示中的任务号回复确认。查看任务状态可使用同一教练项目的 SQLite 管理命令：

```bash
sudo -u road-cycling -H bash /srv/road-cycling-coach/deploy/openclaw.sh coach jobs weixin
```

`route_mismatch` 表示发送被配置检查拦截。先核对上述两个 `.env` 的绑定、唯一会话和私聊范围，再排定新的提醒。实际测试结果见[验收记录](acceptance.md)。

## 停止、更新、备份和重绑

```bash
sudo systemctl stop road-cycling-hermes road-cycling-reminders
sudo bash /srv/road-cycling-coach/deploy/backup.sh /root/road-cycling-coach-backup.tar.gz hermes
sudo systemctl start road-cycling-hermes road-cycling-reminders
```

备份包含此 Profile、教练 `.env` 和 SQLite 目录，按凭据保护。若自定义了数据库路径，同时备份该位置。更新时先停止和备份，再由专用用户在源码目录检出已审查的版本并运行 `node --test`。重新运行 `init-hermes.sh` 安装更新后的入站钩子。服务定义有变化时重新安装两个单元并执行 `systemctl daemon-reload`，再启动并验收。报告中的两条服务可以整体重启。

出现 `session_invalid` 后，在新教练会话发送「帮助」刷新会话，再设置一条新的测试提醒。仍无法收发时，先停止两条教练服务，然后在同一个专用 Profile 重新运行 `gateway setup`，由同一微信账号扫码。核对两个 `.env` 的绑定、唯一私聊和 home channel 后启动。绑定 ID 发生变化时，SQLite 按新路由建立档案，旧路由的数据继续保存在同一个私有数据库。已尝试过的提醒不会自动再发，过期任务会作废。
