# Aibote 社区技能 → GeekClaw 原生技能 移植对照表

> 日期：2026-08-13
> 来源：`E:\BaiduNetdiskDownload\OPC Claw 社区VIP\社区自研成品项目开箱即用`
> 目标：把社区技能的"工作流方法论"移植为调用 GeekClaw 真实能力的原生技能，脱离 Aibote 工具名。

## 0. GeekClaw 能力基线（已核查代码）

| 能力 | 状态 | 入口 |
|---|---|---|
| 图像生成 T2i/I2i/Inpaint | ✅ 已有 | `nomifun-model-invoke` 适配器（openai/ark/dashscope/gemini）；模型覆盖 flux/seedream/sd/dall-e/imagen |
| 视频生成 T2v/I2v/V2v | ✅ 已有 | `openai_videos` / `ark.video_jobs`（seedance/kling/vidu/runway/luma/wanx） |
| TTS / 声音克隆 | ✅ 已有 | `POST /api/tts`（openai/volc/minimax；cosyvoice/sovits 走 TTS 适配） |
| 统一媒体调用 | ✅ 已有 | 代理工具 `nomi_workshop_generate`（capability=t2i\|i2v\|t2v）+ REST `POST /api/creation/tasks` |
| 数字人 / 唇形同步 / HeyGen / wav2lip | ❌ 缺失 | 无后端 |
| 视频剪辑 / FFmpeg | ❌ 缺失 | 无工具（videoEditor/videoInfo 无等价物） |
| 专用视觉工具 / 抽帧 | ⚠️ 部分 | 仅多模态聊天模型（gpt-4o/qwen-vl/gemini），无抽帧 |

## 1. 16 个技能逐一定位

| # | Aibote 技能 | 工作流价值 | GeekClaw 能力 | 移植判定 | 缺口 / 动作 |
|---|---|---|---|---|---|
| 1 | 电商广告视频创作 | 产品图/文→广告视频+口播 | T2v/I2v✅ T2i✅ TTS✅ videoEditor✗ | ✅ 可移植 | 去掉 videoEditor 续接步（或改为可选） |
| 2 | AI全自动短剧 | 小说→分镜→连续短剧 | T2i✅ T2v/I2v✅ 尾帧续接可用 reference_videos✅ 抽帧✗ | ✅ 可移植 | 尾帧用 reference_videos 替代；去掉抽帧依赖 |
| 3 | 反推视频提示词 | 图/视频→提示词 | 多模态聊天✅(图) 抽帧✗ | ⚠️ 部分 | 先支持"图模式"；视频模式待 FFmpeg 抽帧 |
| 4 | 人物图片生成动态视频 | 图→动态视频(Boomerang) | I2v✅ videoExtensions✅(video jobs) 倒放拼接✗ | ✅ 可移植 | 倒放用视频生成参考或省略 |
| 5 | 口播数字人生成 | 文案+人脸→唇形对齐 | TTS✅ 数字人唇形✗ videoDownloader✗ | ⚠️ 部分 | 标准工作流需数字人后端（待补） |
| 6 | 唱歌数字人生成 | 人声驱动数字人唱歌 | uvr5✗ 音乐合成✗ 数字人✗ | ❌ 不可 | 缺 3 个后端 |
| 7 | 全自动视频剪辑 | FFmpeg 剪辑 | FFmpeg✗ videoInfo✗ | ❌ 不可 | 需新增 FFmpeg 适配器 |
| 8 | 视频二次原创 | 洗稿+再生 | 同数字人/剪辑缺口 | ⚠️ 灰区 | 合规需注意（洗稿） |
| 9 | 微信加好友 | 批量加陌生人 | 缺机器人框架 | 🚫 拒绝 | 滥用 |
| 10 | 微信自动发朋友圈 | 朋友圈群发 | 缺机器人框架 | 🚫 不移植 | 平台规则风险 |
| 11 | 小红书批量发布 | 浏览器机器人 | 缺浏览器机器人 | 🚫 不移植 | 平台规则风险 |
| 12 | 抖音批量发布 | 浏览器机器人 | 缺浏览器机器人 | 🚫 不移植 | 平台规则风险 |
| 13 | 视频号批量上传 | 浏览器机器人 | 缺浏览器机器人 | 🚫 不移植 | 平台规则风险 |
| 14 | 视频深度去重与指纹混淆 | 绕过检测 | — | 🚫 拒绝 | 规避反滥用系统 |
| 15 | Soul自动回复 | 安卓机器人 | 缺安卓机器人 + 外联MAC/IP | 🚫 不移植 | 安全+合规 |
| 16 | 音视频下载 | 远程拉exe执行 | — | 🚫 不移植 | 安全风险（远程执行） |

## 2. 移植路线

### Phase A — 直接可移植（调用现有媒体能力，本批先做）
- **电商广告视频创作**（→ `geekclaw-ad-video`）
- **AI全自动短剧创作**（→ `geekclaw-ai-short-drama`）
- **人物图片生成动态视频**（→ `geekclaw-image-to-video`）
- **反推视频提示词（图模式）**（→ `geekclaw-prompt-reverse`）

均改为调用 `nomi_workshop_generate`（capability=t2i\|i2v\|t2v）+ `POST /api/tts`，去掉对 videoEditor/抽帧/数字人的硬依赖。

### Phase B — 需新增适配器（后续）
- **全自动视频剪辑 / 视频二次原创**：新增 FFmpeg 适配器（`nomifun-media-ffmpeg` crate 或外部进程封装），再移植。
- **口播/唱歌数字人**：新增数字人后端（唇形对齐 + 音频驱动视频），再移植标准工作流。

### Phase C — 不移植
- 微信加好友、视频深度去重（滥用/规避）；朋友圈/小红书/抖音/视频号批量、Soul自动回复、音视频下载（平台规则/安全风险）。

## 3. 落点
- 技能文件：`crates/backend/nomifun-app/assets/builtin-skills/<slug>/SKILL.md`
- 注册：`crates/backend/nomifun-app/assets/builtin-skills/skill-tags.json`（补 audience_tags/scenario_tags）
- 调用契约：见 `nomi_workshop_generate`（caps_workshop.rs）参数与 `POST /api/creation/tasks` 响应。
