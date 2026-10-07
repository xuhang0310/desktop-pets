const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// 尽早关闭硬件加速：GPU 进程在虚拟/远程桌面环境里崩溃（STATUS_BREAKPOINT）
// 是"开着开着就闪退"的头号原因；小挂件用软件渲染完全够用。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');

const LAYOUTS = require('./window-layout');
const WIDTH = LAYOUTS.companion.width;
const COLLAPSED_H = LAYOUTS.companion.height;

/* ---------------- 数据目录：便携模式 + 不可写时自动回退 ---------------- */
// 规则：应用目录下存在 data/ 就用它（便携模式，数据跟着程序走）；
// 否则用默认 %APPDATA% 目录；若默认目录不可写（受限/沙箱环境），回退到 data/，
// 否则 Chromium 会因建不了缓存与锁文件而直接退出。
(function ensureUserData() {
  const portable = path.join(app.getAppPath(), 'data');
  if (fs.existsSync(portable)) {
    try { app.setPath('userData', portable); return; } catch (e) {}
  }
  try {
    const dir = app.getPath('userData');
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return;
  } catch (e) {
    try {
      fs.mkdirSync(portable, { recursive: true });
      app.setPath('userData', portable);
      console.warn('[widget] 默认数据目录不可写，已回退到:', portable);
    } catch (e2) {
      console.warn('[widget] 数据目录回退失败:', e2.message);
    }
  }
})();

let win = null;
let ghost = false;
let dragSession = null;
let dragTimer = null;
let hideHotkeyOk = false;
let tray = null;
let trayOk = false;
let quitting = false;
let userHidden = false;   // 用户主动收起（✕ / 隐藏 / 快捷键）

/* ---------------- 持久日志（排查闪退用） ---------------- */
let logStream = null;
function log(...args) {
  const line = `[${new Date().toISOString()}] ` + args.map(a =>
    (a instanceof Error) ? (a.stack || a.message) : (typeof a === 'string' ? a : JSON.stringify(a))
  ).join(' ');
  try {
    if (!logStream) {
      logStream = fs.createWriteStream(path.join(app.getPath('userData'), 'widget.log'), { flags: 'a' });
    }
    logStream.write(line + '\n');
  } catch (e) {}
  try { console.log('[widget]', line); } catch (e) {}
}
// 日志超过 512KB 就轮转一次
try {
  const lp = path.join(app.getPath('userData'), 'widget.log');
  if (fs.existsSync(lp) && fs.statSync(lp).size > 512 * 1024) fs.renameSync(lp, lp + '.old');
} catch (e) {}

// 主进程兜底：任何未捕获异常都不许把应用带走
process.on('uncaughtException', (err) => log('FATAL-GUARD uncaughtException:', err));
process.on('unhandledRejection', (r) => log('FATAL-GUARD unhandledRejection:', String(r)));

function windowAlive() { return !!win && !win.isDestroyed(); }
const voiceService = require('./voice-service').createVoiceService({
  onState: state => { if (windowAlive()) win.webContents.send('voice:state', state); }
});
function suspendInteractions() {
  voiceService.cancel();
  if (windowAlive()) win.webContents.send('window:suspend');
}

/* ---------------- 窗口位置记忆 ---------------- */
function stateFile() { return path.join(app.getPath('userData'), 'window-state.json'); }
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch (e) { return {}; }
}
function saveState(patch) {
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...loadState(), ...patch })); } catch (e) {}
}

let savePosTimer = null;
function rememberPosition() {
  if (!win || win.isDestroyed()) return;
  clearTimeout(savePosTimer);
  savePosTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const { x, y, width, height } = win.getBounds();
    // 保存角色所在的收起窗口位置，展开清单后重启也不会向左漂移。
    saveState({ pos: { x: x + width - WIDTH, y: y + height - COLLAPSED_H } });
  }, 400);
}

/* ---------------- 开机自启（启动文件夹 .lnk，Unicode 安全） ---------------- */
function startupDir() {
  try { return app.getPath('startup'); }
  catch (e) {
    return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  }
}
const STARTUP_LNK = () => path.join(startupDir(), 'TodoWidget.lnk');
const autostartScript = () => path.join(app.getAppPath(), 'set-autostart.ps1');
const VBS_NAME = 'run-supervised.vbs';
const LAUNCHER_NAME = 'run-supervised.cmd';
const supervisorPath = () => path.join(app.getAppPath(), VBS_NAME);
const launcherPath = () => path.join(app.getAppPath(), LAUNCHER_NAME);

/* 启动器：内容保持纯 ASCII（避免代码页问题），
   中文路径由 VBS（Unicode）以参数传进来。
   set ELECTRON_RUN_AS_NODE= 单独一行才是真正"删除"变量——
   否则 Electron 会退化成 Node 模式，启动即报 app is undefined。 */
function launcherContent() {
  return [
    '@echo off',
    'set ELECTRON_RUN_AS_NODE=',
    '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~2\\scripts\\voice-host.ps1" -ElectronPath "%~1" -AppDirectory "%~2" >> "%~3" 2>&1',
    ''
  ].join('\r\n');
}

function ensureLauncher() {
  try {
    const p = launcherPath();
    const buf = Buffer.from(launcherContent(), 'ascii');
    let same = false;
    try { same = fs.readFileSync(p).equals(buf); } catch (e) {}
    if (!same) fs.writeFileSync(p, buf);
    return p;
  } catch (e) { log('launcher write failed:', e.message); return null; }
}

/* 守护启动器（自动生成）：崩溃/闪退（非 0 退出码）8 秒后自动重启；
   托盘菜单"退出"退出码为 0 → 干净结束，不会又被拉起来。
   stdout/stderr 落到 data\widget-out.log，崩溃时能拿到 Chromium 原始报错。 */
function supervisorContent() {
  const launcher = launcherPath();
  const exe = process.execPath;
  const appDir = app.getAppPath();
  const outLog = path.join(app.getPath('userData'), 'widget-out.log');
  const argLine = ['"' + launcher + '"', '"' + exe + '"', '"' + appDir + '"', '"' + outLog + '"'].join(' ');
  // sh.Run 不能直接执行 .cmd，必须经 cmd.exe；/s /c "" "a" "b"" 是唯一在含空格路径下也安全的写法
  const cmdLine = 'cmd.exe /s /c "' + argLine + '"';
  const vbsStr = '"' + cmdLine.replace(/"/g, '""') + '"';
  return [
    "' 悬浮便签 · 守护启动器（由程序自动生成，请勿手改）",
    "' 崩溃闪退（非 0 退出）→ 8 秒后自动重启；正常退出（退出码 0）→ 结束",
    'Set sh = CreateObject("WScript.Shell")',
    'cmd = ' + vbsStr,
    'tries = 0',
    'Do',
    '  rc = sh.Run(cmd, 0, True)',
    '  If rc = 0 Then Exit Do',
    '  tries = tries + 1',
    '  If tries >= 30 Then Exit Do',
    '  WScript.Sleep 8000',
    'Loop',
    ''
  ].join('\r\n');
}

function ensureSupervisor() {
  try {
    ensureLauncher();
    const p = supervisorPath();
    // VBS 用 UTF-16LE+BOM 保存，中文路径才不会乱码
    const buf = Buffer.from('\ufeff' + supervisorContent(), 'utf16le');
    let same = false;
    try { same = fs.readFileSync(p).equals(buf); } catch (e) {}
    if (!same) fs.writeFileSync(p, buf);
    return p;
  } catch (e) { log('supervisor write failed:', e.message); return null; }
}

function isAutostartOn() {
  try { return fs.existsSync(STARTUP_LNK()); } catch (e) { return false; }
}

/* 交给独立 PowerShell 脚本处理（快捷方式是 Unicode，避免代码页把中文路径写坏）；
   受限环境里起不了 PowerShell 就退回注册表方式（同样 Unicode 安全） */
function setAutostart(on) {
  ensureSupervisor();
  const script = autostartScript();
  if (fs.existsSync(script)) {
    try {
      const out = execFileSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, on ? '-On' : '-Off'],
        { windowsHide: true, encoding: 'utf8', timeout: 25000 });
      log('autostart script:', String(out).trim());
      return isAutostartOn();
    } catch (e) {
      log('autostart script failed:', e.message);
    }
  }
  try {
    if (on) app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [app.getAppPath(), '--no-sandbox'] });
    else app.setLoginItemSettings({ openAtLogin: false });
    log('autostart 已退回注册表方式:', on ? 'on' : 'off');
  } catch (e) { log('registry autostart failed:', e.message); }
  return isAutostartOn();
}

/* ---------------- 系统托盘 ---------------- */
function showWidget() {
  userHidden = false;
  if (!windowAlive()) { createWindow(); log('show -> 重建窗口'); return; }
  try { if (win.isMinimized()) win.restore(); } catch (e) { log('restore failed:', e.message); }
  win.show(); win.focus();
  log('show');
}

/* 弹托盘气泡（窗口收起时的提醒方式，不打扰屏幕） */
function balloon(title, content) {
  if (!tray || !trayOk) return;
  try { tray.displayBalloon({ title, content, icon: trayIconImage }); } catch (e) { log('balloon failed:', e.message); }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示便签', click: showWidget },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: isAutostartOn(),
      click: (item) => setAutostart(item.checked) },
    { type: 'separator' },
    { label: '退出悬浮便签', click: () => { quitting = true; log('tray menu -> quit'); app.quit(); } }
  ]);
}

let trayIconImage = null;

function createTray(attempt) {
  attempt = attempt || 1;
  try {
    if (!trayIconImage) trayIconImage = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
    tray = new Tray(trayIconImage);
    tray.setToolTip('大肥鱼 · 桌面陪伴与待办');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', showWidget);
    tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
    tray.on('balloon-click', showWidget);   // 点气泡提示也能唤回
    trayOk = true;
    log('tray ready (attempt ' + attempt + ')');
  } catch (e) {
    trayOk = false;
    log('tray FAILED (attempt ' + attempt + '):', e.message);
    // 托盘起不来会导致"✕ 没进托盘"，自动重试几次
    if (attempt < 4) setTimeout(() => { if (!trayOk) createTray(attempt + 1); }, 1200 * attempt);
  }
}

/* 收起（✕ / — / Ctrl+Alt+H）：
   优先"最小化到任务栏"——任务栏按钮始终在，绝不会出现"收起来就找不到"；
   托盘图标同时保留（右键菜单可退出/开关自启）。 */
function hideToTray() {
  if (!windowAlive()) return;
  userHidden = true;   // 用户主动收起：番茄钟到点也不许再弹回来
  let collapsed = false;
  try {
    win.minimize();
    collapsed = true;
  } catch (e) { log('minimize failed:', e.message); }
  if (!collapsed) { try { win.hide(); } catch (e) {} }
  log(collapsed ? 'collapse -> 任务栏（最小化）' : 'collapse -> 托盘（隐藏）');
  balloon('悬浮便签已收起', '点任务栏的「悬浮便签」即可唤回；也可点右下角托盘图标，或按 Ctrl+Alt+H');
}

/* ---------------- 命令行：--autostart=on|off ---------------- */
const flag = (process.argv.find(a => a.startsWith('--autostart=')) || '').split('=')[1];

/* ---------------- 窗口 ---------------- */
function clampBounds(bounds, workArea) {
  const { x, y, width, height } = bounds;
  const area = workArea || screen.getDisplayNearestPoint({ x, y }).workArea;
  let nx = Math.min(Math.max(x, area.x), area.x + area.width - width);
  let ny = Math.min(Math.max(y, area.y), area.y + area.height - height);
  return { x: Math.round(nx), y: Math.round(ny), width, height };
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = loadState().pos;
  const start = (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y))
    ? { x: saved.x, y: saved.y, width: WIDTH, height: COLLAPSED_H }
    : { x: area.x + 40, y: area.y + 60, width: WIDTH, height: COLLAPSED_H };
  const b = clampBounds(start);

  win = new BrowserWindow({
    ...b,
    frame: false,           // 无边框，角色和移动条通过指针捕获 + IPC 拖动
    transparent: true,      // 透明圆角悬浮
    resizable: false,
    minimizable: true,      // 允许最小化：收起后任务栏按钮仍在，不会被"找不到"
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,     // 保留任务栏按钮，随时可唤回
    alwaysOnTop: true,
    hasShadow: false,
    useContentSize: true,
    icon: path.join(__dirname, 'tray.png'),   // 任务栏 / 任务切换器用新 logo
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.on('move', rememberPosition);
  win.on('minimize', suspendInteractions);
  win.on('hide', suspendInteractions);
  win.on('blur', () => finishWindowDrag('blur'));
  win.webContents.on('did-start-loading', () => { voiceService.cancel(); finishWindowDrag('reload'); });
  win.webContents.on('did-finish-load', () => {
    win.setIgnoreMouseEvents(ghost, { forward: true });
    win.webContents.send('ghost:changed', ghost);
  });
  win.on('closed', () => {
    voiceService.cancel();
    log('window closed (quitting=' + quitting + ' userHidden=' + userHidden + ')');
    win = null;
    dragSession = null;
    clearInterval(dragTimer);
    dragTimer = null;
  });
  log('window created at', b.x + ',' + b.y);
  return win;
}

/* ---------------- 穿透模式 ---------------- */
function setGhost(on) {
  if (!windowAlive()) return false;
  ghost = !!on;
  if (ghost) finishWindowDrag();
  try {
    win.setIgnoreMouseEvents(ghost, { forward: true });
    win.webContents.send('ghost:changed', ghost);
  } catch (e) { log('setGhost failed:', e.message); }
  return ghost;
}

/* ---------------- 生命周期 ---------------- */
if (flag) {
  // 命令行模式：只切换开机自启，不创建窗口（供 .bat 调用）
  app.whenReady().then(() => {
    const want = flag === 'on';
    const got = setAutostart(want);
    console.log(`[悬浮便签] 开机自启${got ? '已开启' : '已关闭'}`);
    app.exit(got === want ? 0 : 1);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWidget());

  // GPU / 渲染 / 网络等子进程崩溃：只记录，不让它带走整个应用
  app.on('child-process-gone', (e, d) => {
    log('child-process-gone:', d.type, d.reason, 'exit=' + d.exitCode);
  });
  app.on('render-process-gone', (e, wc, d) => {
    log('render-process-gone:', d.reason, 'exit=' + d.exitCode);
    // 页面崩了就把它重新加载出来，而不是留下一个空壳窗口
    setTimeout(() => {
      if (windowAlive()) { try { win.reload(); log('已重新加载页面'); } catch (err) { log('reload failed:', err.message); } }
      else { try { createWindow(); log('已重建窗口'); } catch (err) { log('createWindow failed:', err.message); } }
    }, 800);
  });

  app.whenReady().then(() => {
    ensureSupervisor();
    createWindow();
    createTray();
    log('=== 启动 === pid=' + process.pid + ' 数据目录=' + app.getPath('userData'));

    // 快捷键：Ctrl+Alt+G 切换鼠标穿透，Ctrl+Alt+H 隐藏/唤出
    try { globalShortcut.register('Control+Alt+G', () => setGhost(!ghost)); } catch (e) { log('G hotkey failed:', e.message); }
    try {
      hideHotkeyOk = globalShortcut.register('Control+Alt+H', () => {
        if (!windowAlive()) return;
        if (win.isVisible() && !win.isMinimized()) hideToTray(); else showWidget();
      });
    } catch (e) { hideHotkeyOk = false; log('H hotkey failed:', e.message); }
    if (!hideHotkeyOk) log('Ctrl+Alt+H 注册失败，已禁用隐藏功能以免唤不回');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => {
    voiceService.cancel();
    log('=== 退出 === quitting=' + quitting);
    globalShortcut.unregisterAll();
    if (tray) { try { tray.destroy(); } catch (e) {} }
  });
}

// 收到托盘后窗口只是隐藏，不随 window-all-closed 退出；只有托盘"退出"或彻底无法唤回才真退
app.on('window-all-closed', () => { if ((!trayOk && !hideHotkeyOk) || quitting) app.quit(); });

/* ---------------- IPC ---------------- */
ipcMain.handle('voice:support', async event => {
  if (!windowAlive() || event.sender !== win.webContents) return { supported: false };
  const result = await voiceService.support();
  if (!result.supported) log('voice support', { status: result.status, errorCode: result.errorCode, detail: result.detail, stage: result.stage });
  // launcher: started through voice-host.ps1 (启动便签 / npm start), which the recognizer needs on this machine.
  return { ...result, launcher: !!process.env.WIDGET_VOICE_BRIDGE };
});
ipcMain.handle('voice:listen', async event => {
  if (!windowAlive() || event.sender !== win.webContents || ghost || !win.isVisible() || win.isMinimized()) return { status: 'cancelled' };
  const result = await voiceService.listen();
  // Diagnostics contain the outcome and device error only, never recognized speech.
  log('voice result', { status: result.status, errorCode: result.errorCode, detail: result.detail, stage: result.stage });
  return result;
});
ipcMain.on('voice:cancel', event => {
  if (windowAlive() && event.sender === win.webContents) voiceService.cancel();
});
// ✕ = 收到托盘（气泡提示 + 托盘图标可随时唤回）
// 只要还有"唤回手段"（托盘 或 Ctrl+Alt+H）就一律隐藏；两者都没有才真退出
ipcMain.on('window:close', () => {
  if (!windowAlive()) return;
  if (trayOk || hideHotkeyOk) hideToTray();
  else { quitting = true; log('close -> quit（既无托盘也无热键，隐藏后将无法唤回）'); win.close(); }
});

ipcMain.on('window:hide', () => {
  if (!windowAlive()) return;
  // 没有热键时用托盘兜底；两者都没有就不隐藏，避免窗口消失后唤不回
  if (hideHotkeyOk || trayOk) hideToTray();
  else log('hide ignored（无唤回手段）');
});

ipcMain.on('window:pin', (e, pin) => {
  if (!windowAlive()) return;
  try { win.setAlwaysOnTop(!!pin, 'screen-saver'); } catch (err) { log('pin failed:', err.message); }
});

// 以右下角为锚点展开清单，角色位置保持不动；空间不足时夹回屏幕内。
ipcMain.on('window:layout', (e, mode) => {
  if (!windowAlive() || e.sender !== win.webContents || !Object.hasOwn(LAYOUTS, mode)) return;
  const current = win.getBounds();
  const target = LAYOUTS[mode];
  const area = screen.getDisplayNearestPoint({
    x: Math.round(current.x + current.width - WIDTH / 2),
    y: Math.round(current.y + current.height / 2)
  }).workArea;
  win.setBounds(clampBounds({
    x: current.x + current.width - target.width,
    y: current.y + current.height - target.height,
    ...target
  }, area));
});

// Use native DIP cursor coordinates, so moving the window itself cannot change
// the drag delta and mixed-scale monitors do not mix CSS and physical pixels.
function moveWindowDrag() {
  if (!dragSession || !windowAlive() || ghost) return;
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - dragSession.cursor.x;
  const dy = cursor.y - dragSession.cursor.y;
  if (!dragSession.moved && Math.hypot(dx, dy) < 4) return;
  if (!dragSession.moved) {
    win.webContents.send('window:dragging');
    log('drag moving', { dx, dy });
  }
  dragSession.moved = true;
  const x = Math.round(dragSession.bounds.x + dx);
  const y = Math.round(dragSession.bounds.y + dy);
  const current = win.getBounds();
  if (current.x !== x || current.y !== y) win.setPosition(x, y);
}

function finishWindowDrag(reason = 'release') {
  clearInterval(dragTimer);
  dragTimer = null;
  if (!dragSession) return;
  const moved = dragSession.moved;
  log('drag end', { reason, moved });
  dragSession = null;
  if (!windowAlive()) return;
  if (moved) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const current = win.getBounds();
    const clamped = clampBounds(current, area);
    if (current.x !== clamped.x || current.y !== clamped.y) win.setPosition(clamped.x, clamped.y);
    rememberPosition();
  }
  win.setIgnoreMouseEvents(ghost, { forward: true });
}

ipcMain.on('window:drag-start', (e, point) => {
  if (!windowAlive() || e.sender !== win.webContents || ghost || dragSession) return;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const content = win.getContentBounds();
  const zoom = win.webContents.getZoomFactor();
  const px = point.x * zoom, py = point.y * zoom;
  if (px < 0 || py < 0 || px > content.width || py > content.height) return;
  dragSession = {
    cursor: { x: content.x + px, y: content.y + py },
    bounds: win.getBounds(), moved: false
  };
  log('drag start', dragSession);
  win.setIgnoreMouseEvents(false, { forward: true });
  // Moving the native window can coalesce/drop renderer mousemove events.
  // Poll only during an active press, using the OS cursor as the source of truth.
  dragTimer = setInterval(moveWindowDrag, 16);
  dragTimer.unref();
});
ipcMain.on('window:drag-move', e => {
  if (!windowAlive() || e.sender !== win.webContents) return;
  moveWindowDrag();
});
ipcMain.on('window:drag-end', e => {
  if (!windowAlive() || e.sender !== win.webContents) return;
  moveWindowDrag();
  finishWindowDrag();
});

ipcMain.handle('ghost:toggle', () => setGhost(!ghost));

/* ---------------- 开机自启 IPC ---------------- */
ipcMain.handle('autostart:get', () => isAutostartOn());
ipcMain.handle('autostart:set', (e, on) => setAutostart(!!on));

// 番茄钟到时提醒：
//  - 用户主动收起（✕/隐藏）→ 只弹托盘气泡，绝不把窗口弹回来
//  - 否则窗口恰好不在（比如被最小化）→ 温和唤出，不抢焦点
ipcMain.on('window:nudge', (e, msg) => {
  if (!windowAlive()) return;
  const text = typeof msg === 'string' && msg ? msg : '时间到啦';
  if (userHidden) { balloon('🍅 番茄钟提醒', text); return; }
  if (!win.isVisible()) win.showInactive();
});
