# 鲸鲸与小小 · 桌面陪伴

大肥鱼，也叫蒂普斯克。口头禅是“吃白米饭，鲸鲸”，爱玩游戏、懒懒的，一有活儿就惦记找千问或豆包帮忙。蓝发裙装角色保留原有待办和番茄计时；“外包”是角色对白，不会真的向其他服务发送任务。

小小是另一位独立的真人伙伴，采用用户选定的黑衣长卷发、无首饰半身像。她有自己的自我介绍、温柔自然的中文女声和 18 段回应，不使用鲸鲸的口头禅或外包人设。

- 轻点头部或身体会触发不同的动作和对白。鲸鲸使用多张表情姿态，小小使用半身像的轻摇、点头动效。双击打开或收起清单。
- 左侧“摸摸头 / 跳个舞 / 休息”可直接互动。休息时再点角色或“叫醒她”即可唤醒。
- 左侧“说句话”：点击后等待“我在听”，说一句短口令；再次点击或按 Esc 停止。启动时不会打开麦克风。
- 右上角喇叭切换声音，记住静音设置。鲸鲸使用用户选定的 IndexTTS-2 复刻音色，小小使用自然女声；连续点击会打断上一句，不叠音。
- 左侧“换伙伴”选择鲸鲸或小小，自动记住选择。名字、对白和声音随伙伴切换，旧动作和聆听会停止，待办和计时保持不变。
- 点击底部“今日待办”或对话气泡：展开清单。按 Esc 收起。
- 点击底部“专注”：开始或暂停当前计时；展开清单可切换专注、小憩、长憩。
- 按住底部“按住这里移动”使用 Windows 原生拖动；角色身体和清单标题区也支持拖动，轻点角色仍可互动。展开清单时以角色位置为锚点。
- 右侧按钮控制夜间模式、置顶、开机自启、收起。
- Ctrl+Alt+H 收起或唤回；Ctrl+Alt+G 切换鼠标穿透。

Windows 默认保持窗口可交互，不再通过鼠标悬停自动开启整窗穿透。整窗穿透由 Ctrl+Alt+G 手动开启和退出。

双击上一级的 `启动便签.bat` 启动。角色是多张透明 PNG 表情姿态加 CSS 动画，语音回复为随程序提供的本地 MP3，日常使用不需要在线服务或 Live2D。

小小是一位虚构的约 20 岁东方成年女性，写实写真风格、透明背景。目前使用一张原画配合轻摇、点头、跳动和休息符号等动画，未制作真人表情分帧或口型同步；鲸鲸继续使用原有多姿态素材。

## 语音互动

这是短口令互动，不是自由对话聊天。点击麦克风后单次等待约 8 秒，结束、取消、拖动、收起或关闭窗口都会停止聆听。角色说话会先停止聆听，避免识别到自己的声音。

| 试着说 | 当前伙伴的回应 |
| --- | --- |
| 你好 / 小小 / 小小你好 / 大肥鱼 / 蒂普斯克 | 打招呼 |
| 小小跳个舞 / 小小休息一下 / 谢谢小小 | 跳动、休息或回应 |
| 吃白米饭 / 鲸鲸 / 玩游戏 | 鲸鲸使用口头禅；小小使用自己的饮食和游戏回应 |
| 摸摸头 / 跳个舞 | 摸头表情 / 跳舞 |
| 休息一下 / 晚安 / 醒醒 | 休息 / 叫醒 |
| 我累了 / 谢谢 / 你是谁 / 加油 | 安慰、回应或自我介绍 |
| 开始专注 / 暂停专注 | 操作番茄钟；重复“开始专注”不会暂停或重置 |
| 打开清单 | 展开待办 |

输入使用 Windows 已安装的 `zh-CN` System.Speech 识别器，音频在本机识别，不上传或保存录音。若电脑没有中文识别器，仍可使用全部点击交互；若麦克风打不开，检查 Windows 的桌面应用麦克风权限和默认输入设备。识别效果取决于麦克风和环境噪声。本次使用“跳个舞”的录音文件验证了实际识别引擎，未代替用户现场说话验收。

两位伙伴各有 18 段预先生成的本地 MP3。鲸鲸的全部回应使用用户确认的 IndexTTS-2 复刻音色，参考音频来自指定抖音视频的 0.90–5.15 秒。点击或识别到短口令时直接播放文件，运行桌面伙伴无需启动 IndexTTS、占用显卡推理或联网。小小继续使用 `zh-CN-XiaoxiaoNeural`、正常语速和音高。

重新制作鲸鲸语音：使用 `D:\workspace\index-tts2\.venv\Scripts\python.exe` 运行 `scripts/generate-indextts-voice.py`，读取本机 `checkpoints_2` 和 `voice-lab/dafeiyu-indextts2/reference-opening.wav`。脚本只在制作时加载模型，复用已完成且校验匹配的片段，保存无损 WAV 母版，并将 MP3 响度统一为 -18 LUFS。新增或修改对白时同步更新 `pet-dialogue.js` 与新语音包的 `manifest.json`；可用 `--line hello-1 --line who --force` 只重制指定片段。文件生成及解码检查通过后才替换对应素材，过程和校验值记录在 `pack-generation-report.json`。制作前应确认显卡没有其他生成任务。

重新制作小小语音：`python scripts/generate-voice.py --pack voice-human`，这一步需要联网及 `edge-tts`，也支持 `--line` 和 `--force`。该脚本默认制作小小的语音，旧的 `--pack voice-dafeiyu` 仅用于重制保留的 Edge 旧版语音，不影响鲸鲸当前音色。参考：[edge-tts 文档](https://github.com/rany2/edge-tts)、[Microsoft 本机语音识别接口](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.recognize?view=netframework-4.8)。

请通过“启动便签.bat”或 `npm start` 启动。启动器让语音进程与 Electron 独立运行，通过每次启动专属的本地目录传递短口令结果，避免此机上 Electron 子进程初始化中文引擎失败的问题。不监听网络端口；关闭程序会结束语音进程并清理临时口令结果。

启动器直接持有 Electron 进程句柄并保存输出日志，返回真实退出码；不再通过命令行拼接推断退出结果，避免启动失败时误报成功。

## 文件

- `assets/xiaolan.png`：根据用户提供的参考图，通过内置 ImageGen 生成的角色素材。
- `assets/character-prompt.txt`：素材生成的完整提示词。
- `assets/xiaolan-wave.png`、`assets/xiaolan-pat.png`、`assets/xiaolan-sleep.png`：内置 ImageGen 基于原角色生成的挥手、摸头和休息姿态。
- `assets/interaction-prompts.txt`：三个动作素材的完整提示词。
- `assets/human-selected-black.png`：用户选定的小小原画，内置 ImageGen 生成，保留透明通道。
- `preview/character-options/prompts.txt`：形象备选提示词，小小对应第二款“明艳优雅”。`selection.json` 记录用户选择。
- `assets/voice-human/`、`human-dialogue.js`：小小的独立语音和对白。
- `assets/voice-dafeiyu-indextts2/`、`pet-dialogue.js`：鲸鲸当前的 18 段本地复刻语音和对白。
- `voice-lab/dafeiyu-indextts2/`：参考音频、试听样本、`pack-masters/` 无损母版和生成校验报告。
- `scripts/generate-indextts-voice.py`：鲸鲸语音的本地批量制作脚本，支持断点续做。
- `assets/voice-dafeiyu/`、`assets/voice/`：保留的旧版素材，当前播放不使用。
- `pet-interactions.js` / `pet-interactions.css`：动作、语音、麦克风界面。
- `voice-service.js` / `scripts/recognize-voice.ps1` / `voice-commands.json`：本机短口令识别、生命周期和白名单。
- `scripts/voice-host.ps1` / `voice-bridge.js`：识别进程启动、取消、超时与退出清理。
- `companion.css`：角色和展开面板样式。
- `window-layout.js`：窗口尺寸定义，供主进程和验证脚本共用。
- `preview/character-expanded.png`：使用演示数据生成的展开效果。
- `backups/before-character/`：改动前的主要源码备份。
- `backups/before-interaction/`：动作交互改动前的主要源码备份。
- `backups/before-indextts-voice/`：切换鲸鲸复刻音色前的源码备份。

原有便携数据目录和 localStorage 键 `todo-widget-v2` 保持兼容。验证脚本使用独立数据目录。

## 验证

`npm test` 检查透明素材、六种显示状态，以及待办增删改、完成撤销、计时、互动、重载持久化，并生成截图。

`npm run test:native` 使用隐藏的 Electron 窗口检查尺寸切换、角色定位、位置保存、IPC 参数校验和角色拖动事件。测试使用独立目录，替代托盘和全局快捷键，避免影响正在运行的程序。注入事件与模拟光标只能验证代码路径，不能代替 Windows 桌面的实际鼠标拖动验收。

`npm run test:interaction` 检查动作切换、两套共 36 段语音解码、对白与语音清单一致、实际播放文件属于当前伙伴的语音包、静音、连续点击、取消聆听和全部短口令对应行为。测试静音并模拟识别结果，不打开真实麦克风；截图在 `preview/interaction-*.png`。

同一测试还检查小小的透明素材、名字和独立对白／声音、切换时清理旧动作与麦克风、交互后不串回鲸鲸、重启后记忆选择，以及待办和计时不受切换影响。

`npm run test:voice` 从实际启动器和 Electron 走完整语音通信链路，使用 `preview/command-dance.wav` 检查真正的中文识别及取消，不打开麦克风。
