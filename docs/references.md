# 资料核对与实现对应关系

核查日期为 2026-11-17。以下记录公路车教练功能所用的公开资料、各项目的许可证，以及对应的实现和验证范围。

## 训练计划和活动管理

| 项目与许可证 | 可核实的功能 | 首版采用方式与后续用途 |
| --- | --- | --- |
| Coach Watts，Apache-2.0 | 面向耐力运动，可自托管。同步 Intervals.icu 的训练、日历、功率指标与 wellness，能生成结构化课表并通过计划界面一键发布到 Intervals.icu 日历。架构文档和更新日志描述基于近期负荷、恢复和目标的每日建议。自托管版能否每日自动改写计划且自动发布，仍待在自托管实例验证。 [仓库](https://github.com/watt-mind/coach) · [许可证](https://github.com/watt-mind/coach/blob/master/LICENSE) · [更新日志](https://github.com/watt-mind/coach/blob/master/USER_CHANGELOG.md) · [架构](https://github.com/watt-mind/coach/blob/master/docs/01-architecture/system-overview.md) | 参考思路自行实现「选课型、调整课、解释依据」和确认后更新。本仓库日历是本地七天安排，已从 Intervals.icu 只读同步活动，预留课表发布。 |
| Trainingload.ai，AGPL-3.0-only | 官方仓库介绍自托管，接入个人 Intervals.icu API key，导入 FIT、TCX、GPX，提供训练负荷分析、计划与 AI 教练，仓库列出中文文档。官方自托管文档明确注明公开代码采用 AGPL-3.0-only。 [官方自托管文档](https://github.com/trainingload-ai/trainingloadai/blob/main/SELF_HOSTING.md) · [仓库](https://github.com/trainingload-ai/trainingloadai) · [许可文件](https://github.com/trainingload-ai/trainingloadai/blob/main/LICENSE.md) · [中文文档](https://github.com/trainingload-ai/trainingloadai/blob/main/README_ZH.md) | 参考思路自行实现「计划、完成、回顾、确认调整」及活动来源区分。首版支持手动录入、FIT 数据和计划完成状态对照，客观负荷算法留待后续。 |
| Enduragent，MIT | 自托管的公路车 AI 教练。通过桌面、Telegram、终端交互，读取 Intervals.icu 活动、FTP、区间和已记录的 wellness，可写回课程安排，也支持本地 FIT、TCX、GPX。其署名文件记录了验证 CRC、保留多会话记录的 MIT FIT 解析分支。 [仓库](https://github.com/yerzhansa/enduragent) · [许可证](https://github.com/yerzhansa/enduragent/blob/main/LICENSE) · [第三方署名](https://github.com/yerzhansa/enduragent/blob/main/NOTICE.md) | 首版参考其聊天和训练数据层分离方式，自行实现规则和微信通道。已参考其用 CRC 和会话维度验证 FIT 的做法，自行实现摘要解析。其 MIT 解析分支可用于后续扩展格式覆盖。 |
| OpenAthlete，AGPL-3.0 | 可自托管。按赛季、周及单课管理训练；分析活动、区间和负荷；结构化课表可在下次同步时送到 Garmin、COROS、Suunto。 [仓库](https://github.com/openathleteorg/openathlete) · [许可证](https://github.com/openathleteorg/openathlete/blob/main/LICENSE) · [自托管文档](https://docs.openathlete.org/docs/getting-started/self-hosting) | 参考思路自行实现按日区分计划与完成、保存结构化阶段，周计划同时显示未记录、部分完成和已完成。赛季规划和设备账号集成留待后续。 |

**IntervalCoach** 的官方资料描述了两步流程，先从训练阶段、恢复和近期历史选择课型，再按阈值、时间和状态生成间歇。本项目参考流程，以独立规则生成总时长受限的课程，再读手动反馈修正后续推荐。 [官方训练流程](https://docs.intervalcoach.app/articles/6213919-what-is-intervalcoach-and-how-does-it-work)

## 数据接入优先级

首版可用骑手手动记录、FIT、CSV 或 Intervals.icu 摘要。根据后续要求，三条数据路径都提供命令行入口，操作见[骑行数据指南](training-data.md)。

| 优先级 | 接入 | 数据来源、边界与实现方式 |
| --- | --- | --- |
| P1 | Intervals.icu 活动只读同步 | 骑手授权后调用活动列表，先接自行车活动摘要，例如来源活动 ID、开始时间、实际时长、可用的功率字段或 RPE。按外部 ID 去重，缺字段留空。根据账号权限和数据来源验证覆盖范围。当前官方指南注明 Strava 来源的活动受上游政策约束，其他来源也需单独验证。Strava API 政策限制 AI 应用，本项目对自有活动采用 Strava 原始 FIT 手动导出路径。后续日历写入作为显式授权的独立用途。已直接集成官方 API 并自行做字段映射，真实账号待验收。 [官方集成指南](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090) · [权限与来源限制](https://forum.intervals.icu/t/api-access-to-intervals-icu/609) |
| P2 | 本地 `.fit` 活动导入 | 用户提供的 FIT 活动文件。导入自行车会话起始时间、计时器或经过时长，以及可用的距离、爬升、功率和心率摘要。校验 CRC，按活动会话去重，字段缺失时保留已有数值。按公开 FIT 协议自行实现设备会话摘要。Enduragent 的 MIT 解析器和 Garmin SDK 可用于后续扩展兼容验证。 [解析器署名](https://github.com/yerzhansa/enduragent/blob/main/NOTICE.md) · [Garmin SDK 许可](https://github.com/garmin/fit-javascript-sdk/blob/main/LICENSE.txt) |
| P3 | `.zwo` 课程导出 | 数据来自本项目经过时间校验的课表。先支持已设 FTP 的室内课，将秒数和 FTP 比例映射为热身、恒定功率和间歇，使用虚构课表对目标客户端验证导入。RPE 课程需要骑手先提供可转换的阈值或目标功率。参考 GoldenCheetah 与 OpenCycling 的课表格式支持，已自行产生 XML，客户端实机载入待验收。 [GoldenCheetah 课程实现](https://github.com/GoldenCheetah/GoldenCheetah/blob/master/src/Train/ErgFile.cpp) · [Intervals.icu 官方接口](https://intervals.icu/api-docs.html) |

## 功率分析与室内课

| 项目与许可 | 核实的能力与本项目对应 |
| --- | --- |
| GoldenCheetah，GPL-2.0 | 支持功率–持续时间曲线、功率模型和按时长看最佳区间。自行实现 CSV 实测最佳功率摘要，并将其与档案 FTP 及带条件的估计分开。 [仓库](https://github.com/GoldenCheetah/GoldenCheetah) · [COPYING](https://github.com/GoldenCheetah/GoldenCheetah/blob/master/COPYING) · [功率模型说明](https://www.goldencheetah.org/RELEASE/release-notes_3.1.0.html) |
| Endurain，AGPL-3.0 | 自托管活动记录，使用 fitdecode 等工具导入设备活动。参考活动导入和持久化，独立实现 FIT 会话字段、缺失值和去重，存进本地 SQLite。 [仓库与许可](https://github.com/endurain-project/endurain) |
| OpenCycling，GPL-3.0-or-later | 通过蓝牙连接室内训练台，加载 ZWO 并在 ERG 模式运行可执行课段。自行实现结构化课程存储和 ZWO 导出，可把文件导入其训练列表做后续实机验收。 [仓库与许可声明](https://github.com/TheElysium/opencycling) |

## 其他补充调研

| 项目与许可 | 核实的能力与提供给本项目的思路 |
| --- | --- |
| DomestiqueAI，MIT | 使用确定性约束校验训练，按天检查恢复，周回顾比对计划和完成。用于本地规则校验、显示周完成状态和用重复高 RPE 下调重点课。 [仓库与许可证](https://github.com/arnaudstdr/domestique-ai) |
| Sirdar，MIT | 自托管公路车与力量训练教练，每日重新调整处方。用于当天恢复状态触发可解释的调课，首版聚焦自行车。 [仓库与许可证](https://github.com/Kingler16/Sirdar) |
| Training Architect，MIT | 读取 Intervals.icu，以按天的结构化草案让骑手接受、调整或拒绝。用于微信里的长期档案和计划确认规则。 [仓库与许可证](https://github.com/rbrands/training-architect) |
| Aixle，MIT | 通过训练记录和目标推荐课程，提供 Zwift 课表工作流。用于把骑行历史单独建模，并从相同处方生成文字和室内课文件。 [仓库与许可证](https://github.com/kuukuu/Aixle) |
| Garmin FIT JavaScript SDK，FIT Protocol License Agreement | 官方提供 FIT 读写、基准和完整性检查方法。首版独立实现所需会话字段读取与校验。 [仓库](https://github.com/garmin/fit-javascript-sdk) · [许可](https://github.com/garmin/fit-javascript-sdk/blob/main/LICENSE.txt) |

## 微信通道

Hermes Agent（MIT）提供微信 iLink 登录、长轮询和 CLI 定向发送。教练连接独立 Profile，通过官方入站钩子接收已授权的消息，并使用项目自己的训练规则和 SQLite 调度器。 [Hermes Agent 项目与许可证](https://github.com/NousResearch/hermes-agent) · [微信适配器](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin)

OpenClaw 部署路径直接集成 Tencent 的 MIT 微信插件 `2.4.10`。插件扫码登录后保存账户状态，通过长轮询接收消息。教练按 channel、account 和 peer 校验入站，使用该会话回复。主动消息由 SQLite 调度器触发，出站时显式指定同一 account 和 peer。插件重启后会从专用状态目录恢复上下文令牌。手机绑定和实际送达按[验收表](acceptance.md)核对。 [腾讯插件](https://github.com/Tencent/openclaw-weixin/tree/v2.4.10) · [通道实现](https://github.com/Tencent/openclaw-weixin/blob/v2.4.10/src/channel.ts) · [OpenClaw 消息钩子](https://docs.openclaw.ai/plugins/hooks/messages)
