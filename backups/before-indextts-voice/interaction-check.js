// Isolated UI/audio tests. Speech commands are injected, never live microphone audio.
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, 'preview', 'interaction-profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 360, height: 480, useContentSize: true, frame: false, show: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, 'test-preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.setAudioMuted(true);
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const run = source => win.webContents.executeJavaScript(source, true);
  const click = id => run(`document.getElementById('${id}').click()`);
  const action = () => run("document.getElementById('mascot').dataset.action");
  const data = () => run("JSON.parse(localStorage.getItem('todo-widget-v2'))");
  async function command(id) {
    await click('petMic');
    assert(await run("document.getElementById('petMic').classList.contains('listening')"));
    await run(`window.interactionTest.finishVoice({ status: 'recognized', id: '${id}' })`);
    await pause(40);
  }
  async function shot(name) {
    await run("document.getElementById('characterArt').decode()");
    await pause(200);
    fs.writeFileSync(path.join(__dirname, 'preview', `interaction-${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  try {
    await win.loadFile(path.join(__dirname, 'index.html'), { query: { s: 'collapsed' } });
    await run("localStorage.removeItem('xiaolan-muted'); localStorage.removeItem('dafeiyu-appearance')");
    await win.reload();
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await pause(150);
    assert.equal((await run('window.interactionTest.stats()')).voiceCalls, 0, 'Startup never starts microphone');
    assert.equal(await action(), 'idle', 'Startup is quiet');
    for (const name of ['wave', 'pat', 'sleep']) {
      const image = nativeImage.createFromPath(path.join(__dirname, 'assets', `xiaolan-${name}.png`));
      assert(!image.isEmpty(), name + ' image loads');
      const rgba = image.toBitmap();
      let clear = 0, solid = 0;
      for (let n = 3; n < rgba.length; n += 4) { if (rgba[n] === 0) clear++; if (rgba[n] === 255) solid++; }
      assert(clear > 100 && solid > 100, name + ' has transparency and visible pixels');
    }
    // Decode each shipped response with Chromium's actual audio decoder.
    const decoded = await run(`(async () => {
      const context = new AudioContext(); const results = [];
      for (const [pack, dialogue] of [['voice-dafeiyu', PetDialogue], ['voice-human', HumanDialogue]]) {
        for (const line of dialogue) {
          const response = await fetch('assets/' + pack + '/' + line.id + '.mp3');
          const audio = await context.decodeAudioData(await response.arrayBuffer());
          results.push({ pack, id: line.id, duration: audio.duration });
        }
      }
      await context.close(); return results;
    })()`);
    assert.equal(decoded.length, 36);
    assert(decoded.every(item => item.duration > .5 && item.duration < 15), 'All voice lines decode with sensible duration');
    for (const [pack, globalName] of [['voice-dafeiyu', 'PetDialogue'], ['voice-human', 'HumanDialogue']]) {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', pack, 'manifest.json'), 'utf8'));
      assert.deepEqual(await run(globalName), manifest.lines, pack + ' captions match voice manifest');
    }
    assert(await run("HumanDialogue.every(line => !/大肥鱼|鲸鲸|蒂普斯克|千问|豆包/.test(line.text))"), 'Xiaoxiao has independent dialogue');
    const commands = require('./voice-commands.json');
    assert(commands.some(command => command.id === 'hello' && command.phrases.includes('小小你好')));
    assert(commands.some(command => command.id === 'dance' && command.phrases.includes('小小跳个舞')));
    console.log('PASS 3 transparent poses / 36 decoded voice clips / independent dialogue');

    await run(`(() => { const el = document.getElementById('mascot'), r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: r.x + 120, clientY: r.y + 70 })); })()`);
    assert.equal(await action(), 'pat', 'Head pat');
    await shot('pat');
    assert(await run("document.getElementById('mascot').classList.contains('talking')"), 'Voice playback begins on click');
    await run(`(() => { const el = document.getElementById('mascot'), r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: r.x + 120, clientY: r.y + 240 })); })()`);
    assert(await run("/游戏|千问/.test(document.getElementById('petSpeech').textContent)"), 'Body has a different response');
    await click('petDance');
    assert.equal(await action(), 'dance');
    await shot('dance');
    await click('petRest');
    assert.equal(await action(), 'sleep');
    await pause(3300);
    assert.equal(await action(), 'sleep', 'Rest persists beyond normal action');
    await shot('sleep');
    await click('mascot');
    assert.equal(await action(), 'wave', 'Click wakes sleeping pet');
    await click('petSound');
    await click('petPat');
    assert(await run("!document.getElementById('mascot').classList.contains('talking')"), 'Muted interactions remain silent');
    assert.equal(await run("localStorage.getItem('xiaolan-muted')"), 'true', 'Mute persists');
    await click('petSound');
    for (let n = 0; n < 8; n++) await click(n % 2 ? 'petDance' : 'petPat');
    assert((await run("document.querySelectorAll('#petParticles i').length")) <= 6, 'Repeated interactions keep bounded effects');
    await run('window.interactionTest.suspend()');
    assert(await run("!document.getElementById('mascot').classList.contains('talking')"), 'Minimize/hide stops audio');

    await click('petMic');
    assert.equal((await run('window.interactionTest.stats()')).pending, true);
    await click('petMic');
    assert.equal((await run('window.interactionTest.stats()')).pending, false, 'Second click cancels');
    await click('petMic');
    await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    assert.equal((await run('window.interactionTest.stats()')).pending, false, 'Escape cancels');
    await click('petMic');
    await click('petPat');
    assert.equal((await run('window.interactionTest.stats()')).pending, false, 'Touch stops listening before voice response');
    await click('petMic');
    await run("window.interactionTest.finishVoice({ status: 'no-speech' })");
    await pause(40);
    assert(await run("document.getElementById('petSpeech').textContent.includes('没听到')"));
    await command('dance'); assert.equal(await action(), 'dance');
    await command('sleep'); assert.equal(await action(), 'sleep');
    await command('wake'); assert.equal(await action(), 'wave');
    await command('focus'); assert((await data()).pomo.running); assert.equal((await data()).pomo.mode, 'focus');
    const endsAt = (await data()).pomo.endsAt;
    await command('focus'); assert.equal((await data()).pomo.endsAt, endsAt, 'Repeated focus command does not pause or reset');
    await command('pause'); assert(!(await data()).pomo.running);
    await command('open'); assert(await run("!document.body.classList.contains('collapsed')"));
    for (const id of ['hello', 'pat', 'care', 'thanks', 'who', 'cheer', 'rice', 'game']) await command(id);
    await command('rice');
    assert(await run("document.getElementById('petSpeech').textContent.includes('吃白米饭，鲸鲸')"), 'Catchphrase response');
    await command('who');
    assert(await run("document.getElementById('petSpeech').textContent.includes('蒂普斯克')"), 'Character name and alias');
    await click('petMic');
    await run("window.interactionTest.finishVoice({ status: 'recognized', id: 'arbitrary-command' })");
    await pause(40);
    assert(!(await data()).pomo.running, 'Unknown command cannot execute arbitrary behavior');
    await click('petMic');
    await run('window.interactionTest.suspend()');
    assert.equal((await run('window.interactionTest.stats()')).pending, false, 'Hide cancels microphone');

    // A skin change must not swap back to the anime sprite on the next action.
    const beforeSkin = await data();
    await run("if (!document.body.classList.contains('collapsed')) document.getElementById('petTodos').click()");
    await click('petRest');
    assert.equal(await action(), 'sleep');
    await click('petAppearance');
    assert(await run("!document.getElementById('appearancePanel').hidden"), 'Appearance picker opens');
    await shot('appearance-picker');
    await run("document.querySelector('[data-skin-choice=realistic]').click()");
    await pause(180);
    assert.equal(await run('document.body.dataset.skin'), 'realistic');
    assert.equal(await action(), 'idle', 'Switching clears the previous character action');
    assert(await run("!document.getElementById('mascot').classList.contains('mood-sleep')"), 'Switching clears the previous temporary mood');
    assert.equal(await run("document.getElementById('petName').textContent"), '小小');
    assert.equal(await run('document.title'), '小小 · 桌面陪伴');
    assert(await run("document.getElementById('petMic').title.includes('小小你好')"));
    assert.equal(await run("localStorage.getItem('dafeiyu-appearance')"), 'realistic');
    assert(await run("document.getElementById('appearancePanel').hidden"), 'Selection closes picker');
    const realistic = nativeImage.createFromPath(path.join(__dirname, 'assets/human-selected-black.png'));
    assert(!realistic.isEmpty());
    const realisticPixels = realistic.toBitmap();
    let clearPixels = 0, visiblePixels = 0;
    for (let n = 3; n < realisticPixels.length; n += 4) { if (realisticPixels[n] === 0) clearPixels++; if (realisticPixels[n] >= 240) visiblePixels++; }
    assert(clearPixels > 100 && visiblePixels > 100, 'Realistic character has visible pixels and actual alpha');
    for (const control of ['petPat', 'petDance', 'petRest', 'petRest']) {
      await click(control);
      assert(await run("document.getElementById('characterArt').getAttribute('src').includes('human-selected-black')"), 'Selected portrait persists during ' + control);
    }
    await command('who');
    assert(await run("document.getElementById('petSpeech').textContent.startsWith('我叫小小')"), 'Xiaoxiao introduces herself');
    assert.equal(await run("document.getElementById('mascot').dataset.voicePack"), 'realistic', 'Uses Xiaoxiao voice');
    await pause(180);
    assert(await run("document.getElementById('mascot').classList.contains('talking')"), 'Xiaoxiao voice plays');
    await shot('realistic');
    await run(`(() => { const el = document.getElementById('mascot'), r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: r.x + 120, clientY: r.y + 240 })); })()`);
    assert(await run("HumanDialogue.filter(line => line.id.startsWith('poke-')).some(line => line.text === document.getElementById('petSpeech').textContent)"), 'Body click uses Xiaoxiao replies');
    await command('rice');
    assert(await run("!document.getElementById('petSpeech').textContent.includes('鲸鲸')"), 'No whale catchphrase leaks');
    assert.deepEqual((await data()).todo, beforeSkin.todo, 'Switching preserves todos');
    assert.deepEqual((await data()).pomo, beforeSkin.pomo, 'Switching preserves timer');
    await win.loadFile(path.join(__dirname, 'index.html'), { query: { s: 'persist' } });
    assert.equal(await run('document.body.dataset.skin'), 'realistic', 'Appearance persists across reload');
    assert.equal(await run("document.getElementById('petName').textContent"), '小小', 'Name persists across reload');
    assert(await run("!document.getElementById('petSpeech').textContent.includes('千问')"), 'Independent idle text after reload');
    await click('petAppearance');
    await shot('appearance-xiaoxiao');
    await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert(await run("document.getElementById('appearancePanel').hidden"), 'Escape closes picker');
    await click('petAppearance');
    await run("document.querySelector('[data-skin-choice=anime]').click()");
    await pause(180);
    await click('petPat');
    assert.equal(await run("document.getElementById('petName').textContent"), '鲸鲸');
    assert(await run("document.getElementById('characterArt').getAttribute('src').includes('xiaolan-pat')"), 'Anime multi-pose behavior restored');
    await command('who');
    assert(await run("document.getElementById('petSpeech').textContent.includes('蒂普斯克')"), 'Whale identity restored');
    assert.equal(await run("document.getElementById('mascot').dataset.voicePack"), 'anime', 'Whale voice restored');
    await click('petMic');
    await click('petAppearance');
    assert.equal((await run('window.interactionTest.stats()')).pending, false, 'Changing companions cancels the previous microphone session');
    await run("localStorage.setItem('dafeiyu-appearance', 'invalid-skin')");
    await win.loadFile(path.join(__dirname, 'index.html'), { query: { s: 'persist' } });
    assert.equal(await run('document.body.dataset.skin'), 'anime', 'Unknown saved appearance falls back safely');
    assert.deepEqual(errors, [], 'No renderer errors');
    console.log('PASS head/body / dance / sleep/wake / mute / cancel / commands / idempotence');
    console.log('PASS appearance picker / real alpha / interactions / persistence / timer and todo preservation');
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error.stack); console.error(errors); win.destroy(); app.exit(1); }
});
