const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const allowedCommands = new Set(require('./voice-commands.json').map(command => command.id));

// Private per-launch directory supplied by the parent launcher; no HTTP endpoint.
function createVoiceBridge(directory, { onState = () => {} } = {}) {
  let active = null, supportPromise;
  function launch(mode) {
    if (mode === 'listen' && active) return Promise.resolve({ status: 'busy' });
    return new Promise(resolve => {
      const id = randomUUID().replaceAll('-', '');
      const response = path.join(directory, id + '.jsonl');
      const request = path.join(directory, id + '.request');
      const cancel = path.join(directory, id + '.cancel');
      let settled = false, notified = false, poll, timeout;
      function finish(result) {
        if (settled) return;
        settled = true;
        clearInterval(poll); clearTimeout(timeout);
        if (active?.id === id) { active = null; onState('idle'); }
        resolve(result);
      }
      function stop() {
        try { fs.writeFileSync(cancel, 'cancel'); } catch (_) {}
        finish({ status: 'cancelled' });
      }
      try {
        const temporary = path.join(directory, id + '.tmp');
        fs.writeFileSync(temporary, JSON.stringify({ mode }));
        fs.renameSync(temporary, request);
      } catch (_) { finish({ status: 'unavailable' }); return; }
      if (mode !== 'check') { active = { id, stop }; onState('preparing'); }
      poll = setInterval(() => {
        let messages;
        try { messages = fs.readFileSync(response, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean); }
        catch (_) { return; }
        for (const line of messages) {
          let result;
          try { result = JSON.parse(line.replace(/^\uFEFF/, '')); } catch (_) { continue; }
          if (result.status === 'listening') {
            if (!notified && !settled) { notified = true; onState('listening'); }
          } else {
            finish(result.status === 'recognized' && !allowedCommands.has(result.id) ? { status: 'unclear' } : result);
            return;
          }
        }
      }, 80);
      timeout = setTimeout(() => {
        try { fs.writeFileSync(cancel, 'cancel'); } catch (_) {}
        finish({ status: 'timeout' });
      }, 16000);
    });
  }
  return {
    // Only a successful check is cached; a slow or failed one is retried on the next click.
    support() {
      if (!supportPromise) supportPromise = launch('check').then(result => { if (!result.supported) supportPromise = null; return result; });
      return supportPromise;
    },
    listen: () => launch('listen'),
    cancel() { if (!active) return false; active.stop(); return true; },
    // Only used by the explicit launcher probe. The normal host rejects file mode.
    probeFixture: () => launch('file')
  };
}
module.exports = { createVoiceBridge };
