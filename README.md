# Sonic Pulse · Arc Theatre

沉浸式音乐可视化播放器：以 Three.js/WebGL 生成随音频响应的三维点云舞台，提供节奏自适应歌词、官方 MV、30/60/120/不限制帧率、可拖拽桌面歌词与 JARVIS 风格控制台。

## 下载与安装

普通使用不需要打开终端。请在 [GitHub Releases](https://github.com/Hatukio/sonic-pulse/releases/latest) 下载对应系统的安装包：

- Windows：`Sonic Pulse Setup 1.0.0.exe`
- macOS Intel：`Sonic Pulse-1.0.0.dmg`
- macOS Apple Silicon：`Sonic Pulse-1.0.0-arm64.dmg`

安装后从桌面快捷方式、开始菜单、Launchpad 或 Applications 直接打开 Sonic Pulse。Electron 应用会自动启动内嵌本地服务，不需要手动运行 `node server.js` 或 `npm start`。

## 开发者快速开始

需要 Node.js 18 或更高版本。

```bash
npm install
npm start
```

浏览器访问 `http://localhost:3000`。要体验网易云扫码登录、桌面歌词和多显示器布局，请运行 Electron：

```bash
npm run dev
```

自动化验证：

```bash
npm test
```

## Arc Theatre 体验

- **三维点云舞台**：Three.js + WebGL + 后处理辉光/余像；支持专辑雕塑、星云场、能量隧道与流体丝带。封面不可用时自动生成平台色点云，WebGL 不可用时仍保留音乐、歌词与播放器控制。
- **节奏自适应歌词**：优先使用逐字时间轴，缺失时退回逐行歌词；视觉人格可自动识别氛围、流行、冲击与流体节奏，并驱动歌词景深、轨道、粒子或能量表现。
- **JARVIS 控制台**：点击右下角能量核心展开。视觉、歌词、MV、桌面歌词、性能与输入状态均使用真实运行数据，不显示伪造的 GPU 指标。
- **JARVIS AI 陪伴**：默认使用 Sonic 本地免费陪伴，不调用云端模型；用户也可以选择豆包 / 火山方舟、通义千问 / 阿里云百炼、DeepSeek、Ollama、LM Studio 或 OpenAI-compatible 自定义服务。所有在线模型都使用用户自己的 API Key，Sonic 不为用户垫付费用，也不会把 API Key 写入设置文件。
- **音乐推荐动作**：Jarvis 会根据日期、时间、心情、自动定位天气/环境、当前歌曲和播放状态生成推荐方向，并提供可点击的搜索动作，把建议直接转成音乐库搜索。
- **自动定位天气**：用户点击“自动定位天气”并授权系统定位后，Sonic 使用 Open-Meteo 当前天气接口获取摘要；Open-Meteo 不需要 API Key。Sonic 只把“小雨 18℃，风速 6km/h”这类摘要写入设置，不会保存原始经纬度。
- **帧率**：可选 30、60、120 FPS 或 `MAX`（不限制）。选择作用于点云、歌词动效和桌面歌词更新节奏；连续 5 秒低于目标 70% 时只提示建议，不会擅自降档。
- **官方 MV**：歌曲列表只在服务端确认官方 MV 后显示 `MV` 标识。启用时始终选择该官方源的最高可用画质，并使用音频时钟纠偏；MV 不可用或播放失败会自动保留点云模式。
- **桌面歌词**：Electron 中可开启透明、置顶、默认点击穿透的歌词窗。进入布局模式后可拖动/缩放，选择显示器、调整透明度并保存位置；退出布局后不会拦截其他应用的操作。

## 平台差异

| 能力 | 浏览器 | Electron |
| --- | --- | --- |
| 本地音频、点云、沉浸歌词、帧率控制 | 支持 | 支持 |
| 网易云扫码登录 | 不支持，会给出明确提示 | 支持 |
| 桌面歌词、多显示器、点击穿透 | 不支持，会标记为降级状态 | 支持 |
| 官方 MV | 支持（取决于账号、网络与官方源） | 支持（同左） |
| Jarvis AI 陪伴、国内大模型 Provider | 支持，在线模型需要用户自己的 Key | 支持，在线模型需要用户自己的 Key |
| 自动定位天气 | 支持，需要用户授权定位 | 支持，需要用户授权定位 |
| 摄像头手势 | 支持，浏览器需授权摄像头 | 支持，系统需授权摄像头 |

## AI Provider 与费用边界

Sonic 的默认 AI 模式是 `Sonic 本地陪伴`：它只在本机根据时间、心情、天气/环境输入和播放状态生成轻量推荐，不调用任何付费大模型。

可选在线 Provider：

- 豆包 / 火山方舟：默认 endpoint `https://ark.cn-beijing.volces.com/api/v3`
- 通义千问 / 阿里云百炼：默认 endpoint `https://dashscope.aliyuncs.com/compatible-mode/v1`，也可替换成百炼业务空间专属域名
- DeepSeek：默认 endpoint `https://api.deepseek.com`
- OpenAI-compatible 自定义：用于用户自己的网关或其他兼容服务

在线 Provider 必须由用户自己填写 API Key。API Key 只保存在当前前端会话内，用于当次请求，不会写入 `localStorage`、设置文件或打包产物。天气上下文默认由“自动定位天气”按钮更新：系统授权定位后调用 Open-Meteo（无需 API Key）获取当前天气摘要；如果用户拒绝定位，仍可手动填写天气/环境。Sonic 不会保存原始经纬度。

## 内容与权限边界

项目通过社区维护的非官方 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 连接网易云音乐，不是网易云官方开放平台。仅用于个人学习和本地体验，并只播放登录账号本身有权访问的内容。

QQ 音乐和汽水音乐已经预留 ProviderAdapter 骨架，但正式启用需要平台官方开放能力和用户/开发者自己的官方凭证：

- QQ 音乐：需要在 QQ 音乐开发者平台申请，配置 `SONIC_QQ_MUSIC_APP_ID` 与 `SONIC_QQ_MUSIC_APP_KEY` 后再接官方 API。
- 汽水音乐：需要通过汽水音乐/抖音音乐合作平台的官方能力申请，配置 `SONIC_QISHUI_CLIENT_ID` 与 `SONIC_QISHUI_CLIENT_SECRET` 后再接官方 API。
- Apple Music：仍属于后续计划项；它涉及 MusicKit、开发者账号、用户授权和区域版权校验，接入难度更高。

Sonic 不使用 QQ/汽水的非官方抓包或绕权接口，也不会绕过会员、地域、版权或音质限制。

- 不绕过会员、地域、版权或音质限制。
- 不下载、破解或重新分发歌曲和 MV。
- MV 仅代理已确认的网易云官方 MV CDN 地址，并限制目标主机、DNS 结果、超时与请求方式。
- 登录 Cookie 只保存在本地服务进程内存中，进程退出后清除。
- 逆向接口可能随平台更新而失效，也可能触发账号风控；不要部署到公网或用于商业分发。

## 技术结构

- `server.js`：Express 本地代理、账号/歌单/搜索/歌词/音频与官方 MV 路由。
- `server/assistant/`：Jarvis AI Provider 适配、本地陪伴回复和在线模型安全边界。
- `main.js`、`preload.js`：Electron 主窗、登录窗、桌面歌词与安全 IPC。
- `public/src/visual/`：点云生成器、节奏指挥器与 Three.js 场景引擎。
- `public/src/lyrics/`：LRC/逐字歌词解析与音频时钟驱动。
- `public/src/media/`：官方 MV 发现、最高画质选择和同步控制。
- `public/src/assistant/`：自动天气上下文与 Jarvis 推荐上下文。
- `public/src/input/`：本地摄像头手势采样与播放器控制映射。
- `public/src/core/`：设置持久化与帧调度。
- `public/src/ui/`：Arc Theatre / JARVIS 控制台。

Three.js 资源由本地依赖提供，不依赖公共 CDN。渲染器像素比最高限制为 2，以避免高 DPI 屏幕上的无意义负载。

## 当前限制与后续方向

- QQ 音乐、汽水音乐已有官方凭证门禁的 ProviderAdapter 骨架。拿到开放平台资质后可以补搜索、歌词、官方 MV 与播放授权；没有凭证时 UI 会显示 `AUTH` 并给出清晰提示。
- 摄像头手势控制已提供本地实验版：开启后左右挥动切歌、上下挥动调音量。画面只在本机用于运动重心识别，不上传、不录制；后续可以升级为 MediaPipe 手型识别，支持更细的手势命令。
- 本地音频暂不自动匹配在线歌词或 MV，避免误匹配；仍可完整使用点云和音频响应。

## 免责声明

请遵守所登录平台的用户协议、版权规则和会员权益规则。因使用本项目造成的接口失效、账号风控或其他风险由使用者自行承担。
