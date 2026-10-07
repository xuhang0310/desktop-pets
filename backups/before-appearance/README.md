# 大肥鱼 · 桌面陪伴

大肥鱼，也叫蒂普斯克。口头禅是“吃白米饭，鲸鲸”，爱玩游戏、懒懒的，一有活儿就惦记找千问或豆包帮忙。蓝发裙装角色保留原有待办和番茄计时；“外包”是角色对白，不会真的向其他服务发送任务。

- 轻点头部：摸头、眯眼回应；轻点身体：打招呼或害羞回应。双击打开或收起清单。
- 左侧“摸摸头 / 跳个舞 / 休息”可直接互动。休息时再点角色或“叫醒她”即可唤醒。
- 左侧“说句话”：点击后等待“我在听”，说一句短口令；再次点击或按 Esc 停止。启动时不会打开麦克风。
- 右上角喇叭切换声音，记住静音设置。角色使用偏高、轻快的中文女声，连续点击会打断上一句，不叠音。
- 点击底部“今日待办”或对话气泡：展开清单。按 Esc 收起。
- 点击底部“专注”：开始或暂停当前计时；展开清单可切换专注、小憩、长憩。
- 按住底部“按住这里移动”使用 Windows 原生拖动；角色身体和清单标题区也支持拖动，轻点角色仍可互动。展开清单时以角色位置为锚点。
- 右侧按钮控制夜间模式、置顶、开机自启、收起。
- Ctrl+Alt+H 收起或唤回；Ctrl+Alt+G 切换鼠标穿透。

Windows 默认保持窗口可交互，不再通过鼠标悬停自动开启整窗穿透。整窗穿透由 Ctrl+Alt+G 手动开启和退出。

双击上一级的 `启动便签.bat` 启动。角色是多张透明 PNG 表情姿态加 CSS 动画，语音回复为随程序提供的本地 MP3，日常使用不需要在线服务或 Live2D。

## 语音互动

这是短口令互动，不是自由对话聊天。点击麦克风后单次等待约 8 秒，结束、取消、拖动、收起或关闭窗口都会停止聆听。角色说话会先停止聆听，避免识别到自己的声音。

| 试着说 | 大肥鱼的回应 |
| --- | --- |
| 你好 / 大肥鱼 / 蒂普斯克 | 挥手、打招呼 |
| 吃白米饭 / 鲸鲸 / 玩游戏 | 口头禅和游戏回应 |
| 摸摸头 / 跳个舞 | 摸头表情 / 跳舞 |
| 休息一下 / 晚安 / 醒醒 | 休息 / 叫醒 |
| 我累了 / 谢谢 / 你是谁 / 加油 | 安慰、回应或自我介绍 |
| 开始专注 / 暂停专注 | 操作番茄钟；重复“开始专注”不会暂停或重置 |
| 打开清单 | 展开待办 |

输入使用 Windows 已安装的 `zh-CN` System.Speech 识别器，音频在本机识别，不上传或保存录音。若电脑没有中文识别器，仍可使用全部点击交互；若麦克风打不开，检查 Windows 的桌面应用麦克风权限和默认输入设备。识别效果取决于麦克风和环境噪声。本次使用“跳个舞”的录音文件验证了实际识别引擎，未代替用户现场说话验收。

18 段固定回复用 `zh-CN-XiaoyiNeural`、语速 `+8%`、音高 `+32Hz` 生成。重新制作声音才需要联网及 `edge-tts`，运行 `python scripts/generate-voice.py` 只补齐缺少的素材；参数与文本在 `assets/voice-dafeiyu/manifest.json`。参考：[edge-tts 文档](https://github.com/rany2/edge-tts)、[Microsoft 本机语音识别接口](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.recognize?view=netframework-4.8)。

请通过“启动便签.bat”或 `npm start` 启动。启动器让语音进程与 Electron 独立运行，通过每次启动专属的本地目录传递短口令结果，避免此机上 Electron 子进程初始化中文引擎失败的问题。不监听网络端口；关闭程序会结束语音进程并清理临时口令结果。

## 文件

- `assets/xiaolan.png`：根据用户提供的参考图，通过内置 ImageGen 生成的角色素材。
- `assets/character-prompt.txt`：素材生成的完整提示词。
- `assets/xiaolan-wave.png`、`assets/xiaolan-pat.png`、`assets/xiaolan-sleep.png`：内置 ImageGen 基于原角色生成的挥手、摸头和休息姿态。
- `assets/interaction-prompts.txt`：三个动作素材的完整提示词。
- `assets/voice-dafeiyu/`、`pet-dialogue.js`：大肥鱼的本地语音和对白；`assets/voice/` 保留初版素材。
- `pet-interactions.js` / `pet-interactions.css`：动作、语音、麦克风界面。
- `voice-service.js` / `scripts/recognize-voice.ps1` / `voice-commands.json`：本机短口令识别、生命周期和白名单。
- `scripts/voice-host.ps1` / `voice-bridge.js`：识别进程启动、取消、超时与退出清理。
- `companion.css`：角色和展开面板样式。
- `window-layout.js`：窗口尺寸定义，供主进程和验证脚本共用。
- `preview/character-expanded.png`：使用演示数据生成的展开效果。
- `backups/before-character/`：改动前的主要源码备份。
- `backups/before-interaction/`：动作交互改动前的主要源码备份。

原有便携数据目录和 localStorage 键 `todo-widget-v2` 保持兼容。验证脚本使用独立数据目录。

## 验证

`npm test` 检查透明素材、六种显示状态，以及待办增删改、完成撤销、计时、互动、重载持久化，并生成截图。

`npm run test:native` 使用隐藏的 Electron 窗口检查尺寸切换、角色定位、位置保存、IPC 参数校验和角色拖动事件。测试使用独立目录，替代托盘和全局快捷键，避免影响正在运行的程序。注入事件与模拟光标只能验证代码路径，不能代替 Windows 桌面的实际鼠标拖动验收。

`npm run test:interaction` 检查动作切换、18 段语音解码、静音、连续点击、取消聆听和全部短口令对应行为。测试静音并模拟识别结果，不打开真实麦克风；截图在 `preview/interaction-*.png`。

`npm run test:voice` 从实际启动器和 Electron 走完整语音通信链路，使用 `preview/command-dance.wav` 检查真正的中文识别及取消，不打开麦克风。
