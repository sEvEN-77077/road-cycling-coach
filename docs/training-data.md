# 骑行数据指南

网站用户可直接在「同步与导入」上传 FIT、功率 CSV，或从本人 Intervals.icu 同步。服务器配置与界面说明见[网页训练台](web-dashboard.md)。

以下命令都在仓库目录运行。模拟模式导入给虚构骑手。在腾讯云为新微信绑定导入时，使用专用 Linux 用户，命令末尾加 `weixin`。它会读取 `.env` 中的 SQLite 路径与新绑定的两个 ID。完成后在教练会话发送「导入活动」或「功率曲线」。

## FIT 活动

```sh
npm start -- import-fit examples/demo-ride.fit
npm start -- import-fit examples/demo-ride.fit
npm start -- import-fit /path/to/my-ride.fit weixin
```

虚构样例应先新增 1 条，再跳过 1 条。FIT 入口读取活动会话摘要，筛选 `sport=cycling`。单文件上限 25 MiB，验证 FIT 尺寸和 CRC。时长优先用设备计时器，缺失时用经过时间。还读取距离、总爬升、平均及最大功率和平均及最高心率。缺失字段留空，摘要不包含路线、单点流、圈段或自定义开发者指标。活动 ID 或一致的标准化开始时刻用于去重。保留最早导入的记录，重复来源不会覆盖原始值。数据来源和测量方式随摘要显示。导入同一天的骑行可抑制课前提醒，仍可发送 RPE 反馈。仅当档案有已确认 FTP，且前一天有至少 30 分钟计时器或移动时间及设备功率记录，教练才用该次平均功率判定是否需要下调重点课。 [Garmin FIT 协议](https://developer.garmin.com/fit/protocol/) · [活动文件类型](https://developer.garmin.com/fit/file-types/activity/)

从 Strava 网页打开自己的活动，选择「导出原始文件」。如果原始文件为 FIT，即可直接导入。Strava 当前 API 政策限制将 API 数据用于 AI 应用，因此此项目的 Strava 路径采用用户导出的本地活动文件。 [Strava 原始文件导出](https://support.strava.com/en-us/articles/15401919-how-do-i-export-my-strava-data) · [Strava API 政策第 5.3 节](https://www.strava.com/legal/api_policy)

微信文件接收需要对真实通道单独验收。首版由部署者通过本地文件入口导入。

## Intervals.icu 只读活动同步

若 API 只返回第三方来源占位，可在 Intervals.icu 活动列表下载本人的活动 CSV，再使用网站「同步与导入」，或运行 `npm start -- import-intervals-csv /path/to/activities.csv weixin`。支持英文数据字段和网页简体中文表头。活动导入仅保留活动标识、日期和受支持的骑行摘要字段，重复导入会跳过。标准化功率和来源负荷分别保留，缺失的平均功率留空。 [官方 CSV 导出说明](https://forum.intervals.icu/t/download-all-activities-in-csv-format/599)

在 Intervals.icu 的设置页生成自己的个人 API key，填入部署环境 `.env` 的 `COACH_INTERVALS_API_KEY`。导入最近 30 个当地日的活动，参数可设 1–90。

```sh
npm start -- sync-intervals 30
npm start -- sync-intervals 30 weixin
```

只请求当前 API key 对应账号的活动摘要。支持公路、室内、砾石和山地骑行条目，按可用字段映射移动或经过时长、距离、爬升、功率和心率。数据提供方未声明设备实测时，功率注明其来源口径。过滤 API 返回中明确属于 Strava 的来源或标识。API 的来源权限决定可取数据。此版本采用部署者手动同步，未来可再接日历发布、活动增量同步和恢复数据。接口已用虚构响应验证，真实账号授权尚待验收。 [Intervals.icu 官方集成指南](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090) · [活动来源限制](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)

## 功率曲线 CSV 与 FTP

```sh
npm start -- import-power examples/demo-power.csv --date=2026-11-16
npm start -- import-power /path/to/my-curve.csv --date=2026-11-16 weixin
```

CSV 为 UTF-8，表头为 `duration_seconds,power_watts`，也支持 `seconds,watts`。每行是一个持续时间的**实测最佳平均功率**，单位为秒和瓦。保留 5 秒、1 分钟、5 分钟、20 分钟和 60 分钟等常见节点中确实提供的值，同一时长取最高值。此入口读取已算好的功率曲线，设备逐秒功率文件需先转为曲线。可用 `--date=YYYY-MM-DD` 标记记录日期。

「功率曲线」分开显示已确认的档案 FTP、导入的实测功率曲线、最新含功率的活动摘要和可计算的参考 FTP。只有在部署者导入两个标记为 `--ftp-test` 的独立日期数据时，才计算参考估算。项目选用的过滤条件是过去 56 天内、都包含 1200 秒实测点、最近两次功率相差不超过 5%。以两次功率的均值乘 0.95，四舍五入至瓦。标记前应确认两次都是按 20 分钟极限测试做的。这是简化参考估计。教练处方使用骑手明确设置并确认的 FTP，单次短时功率仍是实测记录。 [20 分钟估算法](https://help.trainingpeaks.com/hc/en-us/articles/204071934-How-to-Calculate-Threshold-Values-for-Power-Heart-Rate-or-Pace)

## 导出室内课

当天有骑行安排，且骑手已确认 FTP 时，可以导出课程文件：

```sh
npm start -- zwo today.zwo
npm start -- zwo /path/to/today.zwo weixin
```

课程步骤保存在 SQLite，文本和文件都从同一规则生成。ZWO 时长以秒计，热身和冷身用 FTP 比例渐变，主课、组间恢复与剩余耐力段用各目标区间的中点。文件不会覆盖同名文件。目标软件应设为档案里的同一 FTP。可在 OpenCycling 的 Settings 指定文件夹，在训练列表选课对照时长与功率。XML 和时长已校验，OpenCycling 或 Zwift 图形客户端加载待实测。 [OpenCycling 使用方法](https://github.com/TheElysium/opencycling) · [Zwift 自定义训练](https://support.zwift.com/en_us/custom-workouts-ryGOTVEPs)
