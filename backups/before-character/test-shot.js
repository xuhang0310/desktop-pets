// 离屏截图：node_modules\electron\dist\electron.exe test-shot.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.setPath('userData', path.join(__dirname, '.shot-profile'));

const SCENES = [
  ['collapsed', 340, 244],
  ['expanded', 340, 556],
  ['focus', 340, 276],
  ['sleep', 340, 276],
  ['star', 340, 244],
  ['night', 340, 244],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 360, height: 264, useContentSize: true,
    show: false, frame: false, transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'test-preload.js'),
      contextIsolation: true, nodeIntegration: false, offscreen: true
    }
  });
  win.on('unresponsive', () => console.log('window unresponsive'));

  for (const [scene, w, h] of SCENES) {
    win.setContentSize(w + 20, h + 20);
    await win.loadFile(path.join(__dirname, 'index.html'), { query: { s: scene } })
      .catch(e => console.log('load failed for', scene, e.message));
    if (scene === 'expanded') {
      await win.webContents.executeJavaScript("document.getElementById('btnFold').click()").catch(() => {});
    }
    await sleep(700);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, `shot-${scene}.png`), img.toPNG());
    console.log('saved shot-' + scene + '.png');
  }
  win.destroy();
  app.exit(0);
});
