// Real isolated Electron renderer + production preload/IPC, using fixture LLM/TTS.
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { registerChatIPC } = require('./chat-ipc');
const { createConfigStore } = require('./config-store');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = path.join(__dirname, 'preview', 'chat-profile');
app.setPath('userData', profile); app.disableHardwareAcceleration();
let win;
const events = [], requested = [];
const mp3 = fs.readFileSync(path.join(__dirname, 'assets', 'voice-dafeiyu-indextts2-a', 'hello-1.mp3'));
ipcMain.handle('voice:support', () => ({ supported: false }));
ipcMain.handle('autostart:get', () => false);
ipcMain.handle('autostart:set', () => false);
ipcMain.on('voice:cancel', () => {});
ipcMain.on('window:layout', (_event, mode) => { if (win) win.setSize(mode === 'expanded' ? 700 : 360, 480); });
const backend = registerChatIPC({ ipcMain, safeStorage, directory: () => profile,
  getWindow: () => win && new Proxy(win, { get(target, key) {
    if (key === 'isVisible') return () => true; // Tests stay hidden; no desktop or microphone interaction.
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } }),
  serviceOptions: {
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body); requested.push(request);
      const text = request.messages.at(-1).content;
      const slow = text === 'slow';
      const parts = slow ? ['迟到的回答。'] : ['<think>这个不能显示</think>[action:pat]',
        text.includes('待办') ? '[todo:add:买米][focus:start]' : '', '你好呀。', '我在这里陪着你。'];
      let timer, controller, index = 0;
      const body = new ReadableStream({ start(ctrl) {
        controller = ctrl;
        const tick = () => {
          if (options.signal.aborted) return;
          if (index < parts.length) {
            ctrl.enqueue(Buffer.from('data: ' + JSON.stringify({ choices: [{ delta: { content: parts[index++] } }] }) + '\n\n'));
            timer = setTimeout(tick, slow ? 180 : 35);
          } else { ctrl.enqueue(Buffer.from('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); ctrl.close(); }
        };
        timer = setTimeout(tick, slow ? 180 : 10);
      }, cancel() { clearTimeout(timer); } });
      options.signal.addEventListener('abort', () => { clearTimeout(timer); try { controller.error(new DOMException('Aborted', 'AbortError')); } catch {} }, { once: true });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    },
    tts: { async synthesize(text, { signal }) { signal.throwIfAborted(); events.push(text); return { bytes: mp3, mime: 'audio/mpeg' }; } }
  }
});
app.whenReady().then(async () => {
  try {
    const store = createConfigStore({ directory: profile, safeStorage });
    store.save({ baseURL: 'http://127.0.0.1:39999/v1', model: 'fixture', apiKey: 'ui-fixture-secret', ttsEngine: 'edge' });
    win = new BrowserWindow({ width: 360, height: 480, frame: false, show: false, transparent: true, useContentSize: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    const run = source => win.webContents.executeJavaScript(source, true);
    const click = id => run(`document.getElementById('${id}').click()`);
    async function waitFor(source, label, timeout = 6000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await run(source)) return; await pause(30); }
      throw new Error('Timed out: ' + label);
    }
    async function shot(name) {
      await pause(180);
      fs.writeFileSync(path.join(__dirname, 'preview', 'chat-' + name + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    await win.loadFile(path.join(__dirname, 'index.html'));
    await run("localStorage.removeItem('xiaolan-muted'); localStorage.removeItem('dafeiyu-appearance'); localStorage.removeItem('todo-widget-v2')");
    await win.reload(); await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await run("Promise.all([petChat.clearMemory('jingjing'), petChat.clearMemory('xiaoxiao')])");
    await click('petChatOpen');
    await waitFor("!document.getElementById('chatPanel').hidden && document.querySelector('.chat-empty')", 'panel open');
    assert.equal(win.getBounds().width, 700);
    assert.equal(await run("getComputedStyle(document.getElementById('card')).display"), 'none');
    await shot('empty');
    await click('chatSettings');
    await waitFor("document.getElementById('chatModel').value === 'fixture'", 'settings loaded');
    assert.equal(await run("document.getElementById('chatApiKey').value"), '');
    const publicConfig = await run('petChat.getConfig()');
    assert(!JSON.stringify(publicConfig).includes('ui-fixture-secret'));
    assert.equal(publicConfig.data.hasKey, true);
    await run("document.getElementById('chatModel').value='fixture-ui'; document.getElementById('chatConfigForm').requestSubmit()");
    await waitFor("document.getElementById('chatConfigNotice').textContent.includes('已保存')", 'save settings');
    await shot('settings');
    await click('chatSettingsBack');
    await run("document.getElementById('chatInput').value='帮我在待办记下买米，并开始专注'; document.getElementById('chatComposer').requestSubmit()");
    await waitFor("document.querySelector('.chat-message.assistant p')?.textContent.includes('我在这里')", 'streamed reply');
    assert(!await run("document.getElementById('chatMessages').textContent.includes('think') || document.getElementById('chatMessages').textContent.includes('不能显示')"));
    assert.equal(await run("JSON.parse(localStorage.getItem('todo-widget-v2')).todo[0]"), '买米');
    assert(await run("JSON.parse(localStorage.getItem('todo-widget-v2')).pomo.running"));
    assert.deepEqual(events, ['你好呀。', '我在这里陪着你。']);
    await waitFor("document.getElementById('mascot').classList.contains('talking')", 'real blob audio and analyser');
    await shot('conversation');
    await click('chatStop');
    assert(await run("!document.getElementById('mascot').classList.contains('talking') && document.getElementById('chatStop').hidden"));
    const todo = await run("JSON.parse(localStorage.getItem('todo-widget-v2'))");
    console.log('PASS real preload/IPC / encrypted settings / streaming / controls / blob MP3 decode / stop');

    await run("document.getElementById('chatInput').value='再聊一句'; document.getElementById('chatComposer').requestSubmit()");
    await waitFor("!document.getElementById('chatStop').hidden", 'queue starts');
    await waitFor("document.getElementById('chatStop').hidden", 'both queued audio clips finish', 18000);
    assert(!await run("document.getElementById('chatNotice').textContent.includes('无法播放')"));
    console.log('PASS complete ordered audio queue / final playback cleanup');

    await run("document.getElementById('chatInput').value='slow'; document.getElementById('chatComposer').requestSubmit()");
    await pause(35); await click('petPat'); await pause(250);
    assert(!await run("document.getElementById('chatMessages').textContent.includes('迟到')"));
    assert.equal(await run("document.getElementById('mascot').dataset.action"), 'pat');
    await run("document.getElementById('chatInput').value='slow'; document.getElementById('chatComposer').requestSubmit()");
    await pause(30); await click('petAppearance');
    await run("document.querySelector('[data-skin-choice=realistic]').click()");
    await waitFor("document.body.dataset.skin === 'realistic'", 'character switch');
    await waitFor("document.querySelector('.chat-empty')", 'independent history');
    assert.equal(await run("document.getElementById('chatTitle').textContent"), '和小小聊一聊');
    assert(!await run("document.getElementById('chatMessages').textContent.includes('迟到')"));
    const switched = await run("JSON.parse(localStorage.getItem('todo-widget-v2'))");
    assert.deepEqual(switched.todo, todo.todo); assert.equal(switched.pomo.endsAt, todo.pomo.endsAt);
    await run("document.getElementById('chatInput').value='你好'; document.getElementById('chatComposer').requestSubmit()");
    await waitFor("document.querySelector('.chat-message.assistant p')?.textContent.includes('我在这里')", 'Xiaoxiao reply');
    assert(requested.at(-1).messages[0].content.includes('你是小小'));
    await click('chatStop'); await shot('xiaoxiao');
    await click('chatSettings'); await click('chatClearMemory');
    await waitFor("document.getElementById('chatMemoryHint').textContent.includes('已清空')", 'clear memory');
    assert.equal((await run("petChat.getMemory('xiaoxiao')")).data.turns.length, 0);
    assert.equal((await run("petChat.getMemory('jingjing')")).data.turns.length, 2);
    await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert(await run("document.getElementById('chatPanel').hidden"));
    assert.equal(win.getBounds().width, 360);
    const after = await run("JSON.parse(localStorage.getItem('todo-widget-v2'))");
    assert.deepEqual(after.todo, todo.todo); assert.equal(after.pomo.endsAt, todo.pomo.endsAt);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS touch interruption / late reply rejection / character isolation / memory clear / original todo and timer');
    console.log('ALL CHAT UI CHECKS PASSED'); backend.cancel(); win.destroy(); app.exit(0);
  } catch (error) { console.error(error); backend.cancel(); app.exit(1); }
});
