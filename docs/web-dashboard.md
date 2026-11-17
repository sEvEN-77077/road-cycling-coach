# 独立骑行训练台

训练台是本项目的自托管网站。概览画面参考 Intervals.icu 的训练趋势、恢复监测、功率记录和计划日历，以及 Strava 的活动列表。使用自己部署的服务和 SQLite。 [Intervals.icu 功能](https://www.intervals.icu/) · [Strava 活动分析](https://www.strava.com/)

## 在哪里同步数据

打开训练台的「同步与导入」。

- **Intervals.icu**。在 Intervals.icu 生成个人 API Key，在自己服务器的私有项目 `.env` 填写 `COACH_INTERVALS_API_KEY`。重启网站后，选 7、30 或 90 天并点击「同步活动」。网页读取自行车活动摘要。只读同步，跳过已导入活动及标记为 Strava 来源的活动。Key 留在服务器。
- **FIT**。从码表或平台导出活动原始文件，上传 `.fit`。Strava 网页中的「导出原始文件」若是 FIT，也走此入口。文件经校验后保存会话摘要，重复活动自动跳过。单文件最多 25 MiB。 [Strava 文件导出](https://support.strava.com/en-us/articles/15401919-how-do-i-export-my-strava-data) · [Strava API 政策](https://www.strava.com/legal/api_policy)
- **功率曲线 CSV**。上传按持续时间整理的实测最佳功率。只有明确满足测试条件的记录才用于参考 FTP 估计。同一骑手通过网站或 CLI 导入，使用同一组记录。
- **活动 CSV**。当 Intervals.icu API 只返回活动占位时，从活动列表下载本人的 CSV，在训练台选择文件后自动识别并批量导入。活动来自 Strava 时，可隔几次骑行再重新导出并上传完整 CSV。已存在的活动会跳过。当前 API 同步由已配置 API Key 的骑手点击按钮触发。 [官方导出说明](https://forum.intervals.icu/t/download-all-activities-in-csv-format/599)
- **主观恢复**。在「恢复记录」填睡眠小时和腿部疲劳 0–10。在网页或微信发「骑完了，RPE 4」记录主观用力。这些数据会用于下一次规则建议。

趋势切换近 7、30、90 天和时长、距离、爬升、主观疲劳、睡眠及 RPE。当天有导入时长时，时长图优先使用活动数据，以免与补记的 RPE 或时长重复计数。缺字段显示为空。主观疲劳取自骑手填报，首版没有根据功率或心率推算 CTL、ATL、TSB。课表可切换本周和下周，点击日期查看每一阶段。

## 本机演示

在仓库目录用 Node.js 24 启动。演示用虚构数据和内存数据库，可试用对话和录入。

```bash
node src/web.mjs --demo
```

浏览器打开 http://127.0.0.1:18797。

## 部署自己的私有网站

在[教练部署](tencent-cloud.md)基础上为这一份安装创建新的私有密码。网站仅在服务器回环地址监听，真实数据模式启用 HTTP Basic 登录，用户名为 `coach`。用以下命令独立生成随机密码，并在服务器本地编辑 `.env` 设置 `COACH_WEB_PASSWORD`。

```bash
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
```

网站单独运行时保持 `COACH_WEB_WEIXIN=0`。如果希望使用自己教练的微信档案和双向同步，配置同一项目的 `COACH_WEIXIN_ACCOUNT` 与 `COACH_WEIXIN_PEER`，核对它们属于教练独立绑定，再设置 `COACH_WEB_WEIXIN=1`。已有绑定的升级无需重新扫码。更新源码后重启该教练自己的微信网关和调度器，使新对话进入同步记录。已经处理过的微信历史无回填入口。

```bash
sudo install -m 644 /srv/road-cycling-coach/deploy/road-cycling-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now road-cycling-web
sudo systemctl status road-cycling-web
sudo journalctl -u road-cycling-web -n 40 --no-pager
```

访问方式任选其一。网站本身仍通过密码认证。

1. 已有 SSH 登录时，在电脑运行 `ssh -N -L 18797:127.0.0.1:18797 <用户>@<你的服务器>`，然后打开 http://127.0.0.1:18797。验证交互后可以关闭隧道，网站继续在服务器运行。
2. 需要在手机浏览时，用自己的域名和 HTTPS 反向代理。以下是 Caddy 示例，域名需替换为自己管理的域名。证书和代理启用后再用手机访问。防火墙无需对外开放 18797。 [Caddy 反向代理文档](https://caddyserver.com/docs/quick-starts/reverse-proxy)
3. 只给自己的设备访问时，可用 Tailscale Serve 提供私有 HTTPS 地址。服务器、电脑和手机加入同一个 tailnet，在服务器配置 `tailscale serve --bg http://127.0.0.1:18797`。访问地址以 `tailscale serve status` 为准。机器名、tailnet 或节点授权发生变化后需核对原地址。 [Tailscale Serve 官方指南](https://tailscale.com/docs/features/tailscale-serve)

```caddy
coach.example.org {
    reverse_proxy 127.0.0.1:18797
}
```

### 共享主机上的独立 Tailscale 服务

在[官方 Linux 静态包](https://pkgs.tailscale.com/stable/)下载对应架构的压缩包，核对同一下载地址加 `.sha256` 提供的校验和。把其中的 `tailscale` 和 `tailscaled` 安装到 `/var/lib/road-cycling-coach/tailnet/bin`，目录与文件归专用用户 `road-cycling`，权限设为 `0700`。以下命令创建用户态服务和独立状态文件，服务器保留现有系统路由。

```bash
sudo install -m 644 deploy/road-cycling-tailnet.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now road-cycling-tailnet.service
coachtail() {
  sudo -u road-cycling -H /var/lib/road-cycling-coach/tailnet/bin/tailscale \
    --socket=/run/road-cycling-tailnet/tailscaled.sock "$@"
}
coachtail up --hostname=road-cycling-coach --accept-dns=false --accept-routes=false
coachtail serve --bg http://127.0.0.1:18797
coachtail serve status
```

用自己的 Tailscale 账号批准服务器设备，按提示开启 HTTPS。以后以同一台设备的 `serve status` 核对私有地址。保持服务器注册有效，必要时在 Tailscale 后台为该服务器管理节点密钥到期。网站密码、Tailscale 状态文件和实际访问地址留在部署环境。 [用户态网络模式](https://tailscale.com/docs/concepts/userspace-networking) · [设备密钥到期](https://tailscale.com/kb/1028/key-expiry)

停用网站可执行 `sudo systemctl disable --now road-cycling-web`。备份前停止教练的所有写入服务。备份与恢复仍使用相同的 SQLite 文件和选定的教练 Profile。

## 双向对话

微信里的骑手消息和教练回复会在网页刷新后显示。网页消息由同一个规则引擎处理，再将「你」和「教练」两段作为一条标注为「网页对话」的消息发送到教练微信会话。微信客户端显示它为教练发出的同步消息。网页和微信共享训练档案、课表、恢复状态与待确认设置。

先在已绑定的教练微信会话发送「帮助」建立可用会话。网页消息通过 SQLite 任务发送，网页显示待同步、微信通道成功、待核对或已过期等状态。超时或状态不明的发送不会自动重试；过久的待同步消息会过期。关闭同步开关后重启对应进程，后续微信对话停止进入网页记录，已写入的历史仍保存在私有数据库。上游没有提供微信手机已读回执。

## 每套安装相互隔离

仓库包含通用源码、虚构示例和空白环境变量模板。每个人在自己的服务器上启动，使用自己的域名、密码、数据库、微信绑定和个人 API Key。浏览器只请求当前网站同源的 `/api/*`。服务端的骑手路由由部署环境固定，网页 API 没有指定其他微信账号或目标地址的参数。仓库没有预设云端后端地址、二维码、凭据或真实数据库。

网站 API 与双向同步已在本机通过集成测试。部署后按[验收记录](acceptance.md)分别核对手机端和网站端。
