const path = require('node:path');
const { spawn } = require('node:child_process');
const { endpoint } = require('./config-store');
const MAX_AUDIO = 8 * 1024 * 1024;

async function audioBytes(response, signal) {
  if (!response.ok) throw new Error('本地语音服务合成失败。');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_AUDIO) throw new Error('语音文件过大。');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('本地语音服务未返回 WAV 音频。');
  }
  return bytes;
}
function edgeSpeech(text, persona, config, signal, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    // Pass text through stdin, never through a shell or command-line interpolation.
    const child = spawnProcess(config.pythonPath, [path.join(__dirname, 'scripts', 'realtime-edge-tts.py')], {
      windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
    });
    let chunks = [], size = 0, settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      if (error) { child.kill(); reject(error); } else resolve(value);
    }
    const abort = () => finish(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(new Error('Python 或 edge-tts 未就绪，请检查语音设置。')));
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_AUDIO) finish(new Error('语音文件过大。'));
      else chunks.push(chunk);
    });
    // Do not expose provider diagnostics, recognized text, or subprocess paths in UI/logs.
    child.stderr.resume();
    child.on('close', code => {
      const bytes = Buffer.concat(chunks);
      if (code !== 0 || bytes.length < 512) finish(new Error('在线女声暂不可用，文字回复仍可阅读。'));
      else finish(null, { bytes, mime: 'audio/mpeg', engine: 'edge' });
    });
    child.stdin.end(JSON.stringify({ text, voice: 'zh-CN-XiaoxiaoNeural', rate: persona === 'jingjing' ? '+8%' : '+0%', pitch: '+0Hz' }));
    if (signal.aborted) abort();
  });
}
function createTTSService({ fetchImpl = fetch, spawnProcess = spawn, timeoutMs = 30000 } = {}) {
  return {
    async synthesize(text, { persona, config, signal }) {
      const scoped = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      if (config.ttsEngine === 'off') return null;
      if (config.ttsEngine === 'sovits' && persona === 'jingjing') {
        try {
          if (!config.refAudioPath || !config.refText) throw new Error('请填写复刻音色的参考音频和原文。');
          const response = await fetchImpl(endpoint(config.sovitsURL, true) + '/tts', {
            method: 'POST', redirect: 'error', signal: scoped,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, text_lang: 'zh', ref_audio_path: config.refAudioPath,
              prompt_text: config.refText, prompt_lang: 'zh', text_split_method: 'cut5',
              batch_size: 1, media_type: 'wav', streaming_mode: false })
          });
          return { bytes: await audioBytes(response, scoped), mime: 'audio/wav', engine: 'sovits' };
        } catch (error) {
          signal.throwIfAborted();
          if (!config.edgeFallback) throw error;
          const fallback = await edgeSpeech(text, persona, config,
            AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), spawnProcess);
          return { ...fallback, fallback: true };
        }
      }
      // Xiaoxiao retains her own natural female voice, even when Jingjing uses SoVITS.
      return edgeSpeech(text, persona, config, scoped, spawnProcess);
    }
  };
}
module.exports = { createTTSService, audioBytes };
