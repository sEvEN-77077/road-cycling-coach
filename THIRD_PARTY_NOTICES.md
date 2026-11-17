# 第三方署名

本项目核心使用 Node.js 标准库及其 SQLite 绑定，仓库没有安装时依赖或内嵌的第三方源码。本地测试与演示可在 Node.js 24 上运行。Node.js 和内置 SQLite 随系统运行时分发，许可文本由各自发行方提供。 [Node.js 许可证及第三方说明](https://github.com/nodejs/node/blob/main/LICENSE)

腾讯云部署脚本单独安装 OpenClaw（OpenClaw Foundation，MIT）和 OpenClaw Weixin Channel（Tencent，MIT）。安装包及其依赖保留各自许可证与署名。 [OpenClaw 许可证](https://github.com/openclaw/openclaw/blob/v2026.11.4/LICENSE) · [腾讯插件许可证](https://github.com/Tencent/openclaw-weixin/blob/v2.4.10/LICENSE)

独立 Hermes Profile 的部署可使用 Hermes Agent（Nous Research，MIT）。该运行时单独安装，训练规则和 Hermes 接入插件随本仓库分发。 [Hermes Agent 许可证](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE)

GitHub Actions 工作流调用由 GitHub 提供的 `actions/checkout` 和 `actions/setup-node`（MIT）。 [checkout 许可](https://github.com/actions/checkout/blob/v4/LICENSE) · [setup-node 许可](https://github.com/actions/setup-node/blob/v4/LICENSE)

训练流程的调研来源及候选接入详见 [参考资料](docs/references.md)。首版自行实现训练逻辑、交互文案与数据存储。
