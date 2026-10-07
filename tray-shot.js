// 渲染吉祥物托盘图标：electron.exe tray-shot.js → tray.png
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.setPath('userData', path.join(__dirname, '.shot-profile'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 64, height: 64, useContentSize: true,
    show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, 'tray-shot.html'));
  await new Promise(r => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, 'tray.png');
  try { fs.copyFileSync(out, out + '.bak'); } catch (e) {}
  fs.writeFileSync(out, img.toPNG());
  console.log('tray.png updated');
  win.destroy();
  app.exit(0);
});
