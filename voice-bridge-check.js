// Starts only via voice-host.ps1 -Probe; validates the actual Electron transport.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.setPath('userData', path.join(__dirname, 'preview', 'bridge-profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    const service = require('./voice-service').createVoiceService();
    const support = await service.support();
    assert.equal(support.supported, true, JSON.stringify(support));
    const cancelled = service.probeFixture();
    service.cancel();
    assert.equal((await cancelled).status, 'cancelled');
    await new Promise(resolve => setTimeout(resolve, 400));
    const result = await service.probeFixture();
    assert.equal(result.status, 'recognized', JSON.stringify(result));
    assert.equal(result.id, 'dance');
    fs.writeFileSync(path.join(__dirname, 'preview/bridge-result.json'), JSON.stringify({ support, result }));
    console.log('PASS real recognizer / cancellation / Electron launcher bridge');
    win.destroy(); app.exit(0);
  } catch (error) { fs.writeFileSync(path.join(__dirname, 'preview/bridge-result.json'), error.stack); console.error(error); win.destroy(); app.exit(1); }
});
