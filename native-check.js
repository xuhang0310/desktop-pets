// Integration checks for renderer/preload IPC and real BrowserWindow bounds.
// This hidden, offscreen window and controlled cursor do NOT test Windows native
// mouse hit testing, click-through, or CSS app-region dragging. Those need a
// separate visible-window test with actual desktop input.
// Tray and global hotkeys are stubbed so this cannot disturb the running widget.
const electron = require('electron');
const { app, BrowserWindow, screen } = electron;
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('node:assert/strict');
const { once } = require('events');
const sandbox = path.join(__dirname, 'preview', 'native-profile');
fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
app.setPath('userData', path.join(sandbox, 'data'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let testWindow;
let testCursor = null;
class HiddenWindow extends BrowserWindow {
  constructor(options) {
    super({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false, offscreen: true } }); testWindow = this;
    this.webContents.setAudioMuted(true);
    this.webContents.on('console-message', (_event, level, message) => { if (level >= 3) console.error('Renderer:', message); });
  }
}
class TestTray {
  setToolTip() {} setContextMenu() {} on() {} destroy() {}
  displayBalloon() {} popUpContextMenu() {}
}
const isolatedApp = new Proxy(app, {
  get(target, key) {
    if (key === 'getAppPath') return () => sandbox;
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  }
});
const shim = {
  ...electron, app: isolatedApp, BrowserWindow: HiddenWindow, Tray: TestTray,
  screen: new Proxy(screen, {
    get(target, key) {
      if (key === 'getCursorScreenPoint') return () => testCursor || screen.getCursorScreenPoint();
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  }),
  globalShortcut: { register: () => true, unregisterAll() {} }
};
const filename = path.join(__dirname, 'main.js');
const subject = new Module(filename, module);
subject.filename = filename;
subject.paths = module.paths;
subject.require = id => id === 'electron' ? shim : Module.createRequire(filename)(id);
subject._compile(fs.readFileSync(filename, 'utf8'), filename);

app.whenReady().then(async () => {
  try {
    const win = testWindow;
    if (win.webContents.isLoading()) await once(win.webContents, 'did-finish-load');
    await pause(200);
    const run = js => win.webContents.executeJavaScript(js);
    const area = screen.getPrimaryDisplay().workArea;
    win.setBounds({ x: area.x + Math.max(340, Math.floor((area.width - 700) / 2) + 340), y: area.y + 30, width: 360, height: 480 });
    const original = win.getBounds();
    await run("document.getElementById('petTodos').click()");
    await pause(200);
    const expanded = win.getBounds();
    assert.equal(expanded.width, 700, 'Native window expands');
    assert.equal(expanded.x + expanded.width, original.x + original.width, 'Character stays anchored');
    await run("document.getElementById('btnFold').click()");
    await pause(500);
    assert.deepEqual(win.getBounds(), original, 'Native window collapses to original position');
    const saved = JSON.parse(fs.readFileSync(path.join(sandbox, 'data', 'window-state.json')));
    assert.equal(saved.pos.x, original.x, 'Companion anchor is saved');
    await run("window.widget.setLayout('invalid')");
    await pause(40);
    assert.equal(win.getBounds().width, 360, 'Reject unknown layout');
    const mouseCalls = [];
    const setIgnore = win.setIgnoreMouseEvents.bind(win);
    win.setIgnoreMouseEvents = (ignore, options) => { mouseCalls.push(ignore); setIgnore(ignore, options); };
    assert.equal(await run('window.widget.toggleGhost()'), true, 'Ghost shortcut path enables');
    await pause(50);
    assert(await run("document.body.classList.contains('ghost')"), 'Ghost indicator is visible');
    assert.equal(mouseCalls.at(-1), true, 'Explicit ghost enables whole-window passthrough');
    assert.equal(await run('window.widget.toggleGhost()'), false, 'Ghost shortcut path disables');
    await pause(50);
    assert.equal(mouseCalls.at(-1), false, 'Disabling ghost restores mouse input');
    assert(await run("!document.body.classList.contains('ghost')"), 'Ghost indicator clears');

    const handle = await run(`(() => {
      const el = document.querySelector('.drag-handle');
      return { region: getComputedStyle(el).getPropertyValue('-webkit-app-region').trim(), customDrag: el.hasAttribute('data-drag-handle') };
    })()`);
    assert.equal(handle.region, 'drag', 'Move bar is configured as a native drag region');
    assert.equal(handle.customDrag, false, 'Move bar does not also start renderer dragging');

    // Chromium-injected events exercise renderer IPC and real window positioning,
    // but bypass desktop hit testing. Never report these as native mouse tests.
    await run(`window.dragEvents = []; ['pointerdown', 'pointermove', 'pointerup', 'lostpointercapture'].forEach(type => document.addEventListener(type, e => window.dragEvents.push({ type, x: e.screenX, y: e.screenY, clientX: e.clientX, clientY: e.clientY, target: e.target.id, primary: e.isPrimary }), true));`);
    const sendPointer = (type, x, y, cursor = testCursor) => {
      win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), globalX: Math.round(cursor.x), globalY: Math.round(cursor.y), button: 'left', clickCount: 1 });
    };
    const pointer = async (type, x, y) => {
      sendPointer(type, x, y);
      await pause(80);
    };
    for (const selector of ['#mascot']) {
      const before = win.getBounds();
      const point = await run(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const box = el.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2, region: getComputedStyle(el).getPropertyValue('-webkit-app-region') };
      })()`);
      assert.notEqual(point.region.trim(), 'drag', 'No native region swallows pointer events');
      testCursor = { x: before.x + point.x, y: before.y + point.y };
      await pointer('mouseMove', point.x, point.y);
      await pointer('mouseDown', point.x, point.y);
      if (!(await run("document.body.classList.contains('drag-held')"))) console.log('Pointer down diagnostics:', await run("JSON.stringify({ events: window.dragEvents, body: document.body.className })"));
      assert(await run("document.body.classList.contains('drag-held')"), 'Injected pointer down starts drag: ' + selector);
      testCursor = { x: testCursor.x + 90, y: testCursor.y + 30 };
      await pointer('mouseMove', point.x + 90, point.y + 30);
      if (win.getBounds().x !== before.x + 90) console.log('Drag diagnostics:', await run("JSON.stringify({ events: window.dragEvents, body: document.body.className })"), mouseCalls);
      assert.equal(win.getBounds().x, before.x + 90, 'Window follows horizontal drag: ' + selector);
      assert.equal(win.getBounds().y, before.y + 30, 'Window follows vertical drag: ' + selector);
      testCursor = { x: testCursor.x + 45, y: testCursor.y + 15 };
      await pointer('mouseMove', point.x + 45, point.y + 15);
      if (win.getBounds().x !== before.x + 135) console.log('Second move diagnostics:', await run("JSON.stringify({ events: window.dragEvents, body: document.body.className })"), mouseCalls);
      assert.equal(win.getBounds().x, before.x + 135, 'Second move uses original screen anchor: ' + selector);
      assert.equal(win.getBounds().y, before.y + 45, 'Moving window does not cause cursor drift');
      await pointer('mouseUp', point.x, point.y);
      assert(await run("!document.body.classList.contains('drag-held')"), 'Release ends drag');
      assert(await run("!document.getElementById('mascot').classList.contains('boing')"), 'Drag does not also trigger pet click');
      const after = win.getBounds();
      // Windows can round the outer DIP rectangle by one pixel at fractional DPI.
      assert(Math.abs(after.width - before.width) <= 1, 'Drag must not resize beyond DPI rounding');
      assert(Math.abs(after.height - before.height) <= 1, 'Drag must not change height beyond DPI rounding');
      testCursor = { x: testCursor.x + 40, y: testCursor.y + 30 };
      await pointer('mouseMove', point.x + 40, point.y + 30);
      assert.deepEqual(win.getBounds(), after, 'Release stops movement');
      await pause(500);
      const position = JSON.parse(fs.readFileSync(path.join(sandbox, 'data', 'window-state.json')));
      assert.equal(position.pos.x, after.x + after.width - 360, 'Dragged companion anchor persists: ' + JSON.stringify(after));
    }

    // Regression: queue a complete quick gesture without yielding the main
    // event loop. The start IPC therefore arrives after the controlled OS cursor
    // has already reached its endpoint, just like the observed desktop failure.
    // The original press must come from pointerdown client coordinates, not a
    // late getCursorScreenPoint() sample in the start IPC handler.
    const quickBefore = win.getBounds();
    const content = win.getContentBounds();
    const press = { x: 180, y: 265 };
    const delta = { x: -100, y: 50 };
    const startCursor = { x: content.x + press.x, y: content.y + press.y };
    const endCursor = { x: startCursor.x + delta.x, y: startCursor.y + delta.y };
    let startObserved = null;
    electron.ipcMain.once('window:drag-start', (_event, point) => {
      startObserved = { point, cursor: { ...testCursor } };
    });
    testCursor = startCursor;
    sendPointer('mouseMove', press.x, press.y);
    sendPointer('mouseDown', press.x, press.y);
    testCursor = endCursor;
    sendPointer('mouseMove', press.x + delta.x, press.y + delta.y);
    sendPointer('mouseUp', press.x + delta.x, press.y + delta.y);
    await pause(180);
    assert(startObserved, 'Quick gesture delivered a drag-start IPC');
    assert.deepEqual(startObserved.cursor, endCursor, 'Start IPC sees the cursor already at the endpoint');
    assert.deepEqual(startObserved.point, press, 'Renderer preserves pointerdown client coordinates');
    const quickAfter = win.getBounds();
    assert.equal(quickAfter.x, quickBefore.x + delta.x, 'Quick drag retains the full horizontal displacement');
    assert.equal(quickAfter.y, quickBefore.y + delta.y, 'Quick drag retains the full vertical displacement');
    assert(await run("!document.body.classList.contains('drag-held')"), 'Quick gesture releases capture state');
    assert(await run("!document.getElementById('mascot').classList.contains('boing')"), 'Quick drag suppresses pet click');
    testCursor = { x: endCursor.x + 40, y: endCursor.y + 30 };
    await pointer('mouseMove', press.x + 40, press.y + 30);
    assert.deepEqual(win.getBounds(), quickAfter, 'Quick gesture release stops movement');
    await pause(550);
    const quickSaved = JSON.parse(fs.readFileSync(path.join(sandbox, 'data', 'window-state.json')));
    assert.equal(quickSaved.pos.x, quickAfter.x + quickAfter.width - 360, 'Quick drag position persists');

    // A normal press/release must still activate the original interaction.
    const clickContent = win.getContentBounds();
    testCursor = { x: clickContent.x + 170, y: clickContent.y + 230 };
    await pointer('mouseMove', 170, 230);
    await pointer('mouseDown', 170, 230);
    await pointer('mouseUp', 170, 230);
    assert(await run("document.getElementById('mascot').classList.contains('boing')"), 'Light click still interacts');
    console.log('PASS isolated integration: window sizing / anchor / persistence / IPC validation / ghost / character drag / delayed-start quick drag / click');
    console.log('NOT COVERED: desktop hit testing, transparent-pixel passthrough, or native move-bar dragging. Use a separate visible-window desktop-input check.');
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  }
});
