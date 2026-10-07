const { spawn } = require('child_process');
const path = require('path');
const commands = require('./voice-commands.json');
const allowedCommands = new Set(commands.map(command => command.id));

// Windows' installed Mandarin grammar recognizer; no cloud audio or recording.
function createVoiceService({ onState = () => {} } = {}) {
  if (process.env.WIDGET_VOICE_BRIDGE) {
    return require('./voice-bridge').createVoiceBridge(process.env.WIDGET_VOICE_BRIDGE, { onState });
  }
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(__dirname, 'scripts', 'recognize-voice.ps1');
  let active = null;
  let supportPromise = null;

  function launch(mode) {
    if (process.platform !== 'win32') return Promise.resolve({ status: 'unsupported', supported: false });
    if (mode === 'listen' && active) return Promise.resolve({ status: 'busy' });
    return new Promise(resolve => {
      let settled = false;
      let last = null;
      let buffer = '';
      let timer;
      const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (active?.child === child) { active = null; onState('idle'); }
        resolve(result);
      };
      if (mode === 'listen') {
        active = { child, finish };
        onState('preparing');
      }
      const readLine = line => {
        try {
          const message = JSON.parse(line.replace(/^\uFEFF/, ''));
          if (message.status === 'listening') { if (mode === 'listen' && !settled && active?.child === child) onState('listening'); return; }
          if (message.status === 'recognized' && !allowedCommands.has(message.id)) {
            last = { status: 'unclear' }; return;
          }
          last = message;
        } catch (_) {}
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 16384) { child.kill(); finish({ status: 'unavailable' }); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          readLine(buffer.slice(0, newline).trim());
          buffer = buffer.slice(newline + 1);
        }
      });
      child.stderr.resume();
      child.on('error', () => finish({ status: 'unavailable', supported: false }));
      child.on('close', () => { if (buffer.trim()) readLine(buffer.trim()); finish(last || { status: 'unavailable', supported: false }); });
      timer = setTimeout(() => { child.kill(); finish({ status: 'timeout', supported: false }); }, mode === 'listen' ? 14000 : 12000);
    });
  }
  return {
    // Only a successful check is cached; a slow or failed one is retried on the next click.
    support() {
      if (!supportPromise) supportPromise = launch('check').then(result => { if (!result.supported) supportPromise = null; return result; });
      return supportPromise;
    },
    listen: () => launch('listen'),
    cancel() {
      if (!active) return false;
      const session = active;
      session.child.kill();
      session.finish({ status: 'cancelled' });
      return true;
    }
  };
}
module.exports = { createVoiceService };
