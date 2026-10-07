// Isolated Electron smoke checks and screenshots. Never reads the user's live data.
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const layouts = require('./window-layout');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.setPath('userData', path.join(__dirname, '.shot-profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.join(__dirname, 'preview');
fs.mkdirSync(output, { recursive: true });

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({
    ...layouts.companion, useContentSize: true, show: false, frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'test-preload.js'),
      contextIsolation: true, nodeIntegration: false, offscreen: true
    }
  });
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  const run = source => win.webContents.executeJavaScript(source);
  const click = id => run(`document.getElementById(${JSON.stringify(id)}).click()`);
  const data = () => run("JSON.parse(localStorage.getItem('todo-widget-v2'))");
  try {
    const sprite = nativeImage.createFromPath(path.join(__dirname, 'assets', 'xiaolan.png'));
    assert(!sprite.isEmpty(), 'Character sprite loads');
    const pixels = sprite.toBitmap();
    let transparent = 0, opaque = 0;
    for (let n = 3; n < pixels.length; n += 4) {
      if (pixels[n] === 0) transparent++;
      if (pixels[n] === 255) opaque++;
    }
    assert(transparent > 100 && opaque > 100, 'Sprite has genuine transparent alpha and visible pixels: ' + JSON.stringify({ transparent, opaque, bytes: pixels.length, size: sprite.getSize() }));
    for (const scene of ['collapsed', 'expanded', 'focus', 'sleep', 'star', 'night']) {
      const dimensions = scene === 'expanded' ? layouts.expanded : layouts.companion;
      win.setContentSize(dimensions.width, dimensions.height);
      await win.loadFile(path.join(__dirname, 'index.html'), { query: { s: scene } });
      await run("document.fonts.ready.then(() => document.getElementById('characterArt').decode())");
      await win.webContents.insertCSS('* { animation: none !important; transition: none !important; }');
      if (scene === 'expanded') await click('petTodos');
      await pause(250);
      const layout = await run(`(() => {
        const card = document.getElementById('card');
        const dock = document.querySelector('.pet-dock').getBoundingClientRect();
        return {
          collapsed: document.body.classList.contains('collapsed'),
          visible: getComputedStyle(card).display !== 'none',
          dockVisible: dock.bottom <= innerHeight && dock.left >= 0 && dock.right <= innerWidth,
          spriteLoaded: document.getElementById('characterArt').naturalWidth > 0,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          speech: document.getElementById('petSpeech').textContent
        };
      })()`);
      assert.equal(layout.visible, scene === 'expanded', 'Panel visibility: ' + scene);
      assert(layout.dockVisible && layout.spriteLoaded && !layout.pageOverflow, 'Visible layout: ' + scene);
      if (scene === 'focus') assert(layout.speech.includes('安心'), 'Focus status');
      if (scene === 'sleep') assert(layout.speech.includes('喝口水'), 'Rest status');
      if (scene === 'star') assert(layout.speech.includes('完成'), 'Completion status');
      fs.writeFileSync(path.join(output, `character-${scene}.png`), (await win.webContents.capturePage()).toPNG());
      console.log('PASS layout ' + scene);
    }

    win.setContentSize(layouts.expanded.width, layouts.expanded.height);
    await win.loadFile(path.join(__dirname, 'index.html'), { query: { s: 'expanded' } });
    await click('petTodos');
    await run(`(() => {
      const input = document.getElementById('input');
      input.value = '验证角色版待办';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    assert((await data()).todo.includes('验证角色版待办'), 'Add todo');
    await run(`(() => {
      const text = document.querySelector('#todoList .text');
      text.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      text.textContent = '验证编辑后的待办';
      text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    assert((await data()).todo.includes('验证编辑后的待办'), 'Edit todo');
    await run("document.querySelector('#todoList .check').click()");
    await pause(520);
    assert((await data()).done.includes('验证编辑后的待办'), 'Complete todo');
    await run("document.querySelector('#doneList .check').click()");
    assert((await data()).todo.includes('验证编辑后的待办'), 'Undo completion');
    await run("document.querySelector('#todoList .del').click()");
    assert(!(await data()).todo.includes('验证编辑后的待办'), 'Delete todo');
    await click('petFocus');
    assert((await data()).pomo.running, 'Start from character dock');
    await click('petFocus');
    assert(!(await data()).pomo.running, 'Pause from character dock');
    await click('chipShort');
    assert.equal((await data()).pomo.mode, 'short', 'Select rest');
    await click('pomoReset');
    assert.equal((await data()).pomo.remain, 5 * 60000, 'Reset rest');
    await click('mascot');
    assert(await run("document.getElementById('mascot').classList.contains('mood-happy')"), 'Character responds');
    await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    assert(await run("document.body.classList.contains('collapsed')"), 'Escape closes panel');
    await click('petBubble');
    assert(await run("!document.body.classList.contains('collapsed')"), 'Bubble opens panel');
    await click('btnNight');
    assert((await data()).night, 'Night preference saved');
    const before = await data();
    await win.loadFile(path.join(__dirname, 'index.html'), { query: { s: 'persist' } });
    assert.deepEqual((await data()).todo, before.todo, 'Todos persist on reload');
    assert.equal((await data()).night, before.night, 'Appearance persists on reload');
    assert.deepEqual(errors, [], 'No renderer errors');
    console.log('PASS add / edit / complete / undo / delete / timer / interaction / reload');
    console.log('PASS transparent sprite ' + JSON.stringify(sprite.getSize()));
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    console.error('Renderer errors:', errors);
    win.destroy();
    app.exit(1);
  }
});
