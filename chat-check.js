// Deterministic local HTTP fixtures: no paid API calls and no live microphone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { createConfigStore, endpoint } = require('./config-store');
const { createChatService, allowedControl } = require('./chat-service');
const { createMemoryStore } = require('./chat-memory');
const { ReplyFilter, SentenceBuffer, readSSE } = require('./chat-stream');
const { createTTSService } = require('./tts-service');
const { registerChatIPC } = require('./chat-ipc');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-widget-chat-'));
const safeStorage = { isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from(text.split('').reverse().join('')),
  decryptString: bytes => bytes.toString().split('').reverse().join('') };

async function main() {
  let filtered = '', tags = [], spoken = [];
  const sentences = new SentenceBuffer(text => spoken.push(text));
  const filter = new ReplyFilter(text => { filtered += text; sentences.push(text); }, tag => tags.push(tag));
  for (const part of ['<thi', 'nk>private reasoning', '</thi', 'nk>[acti', 'on:dance]你好。', '[todo:add:买米]', '**我们', '去玩游戏！**', '<think>hidden</think>', '[action:unknown]', '[action:pa']) filter.push(part);
  filter.push('', true); sentences.push('', true);
  assert.equal(filtered, '你好。我们去玩游戏！');
  assert.deepEqual(spoken, ['你好。', '我们去玩游戏！']);
  assert.deepEqual(tags, [{ type: 'action', value: 'dance' }, { type: 'todo', value: '买米' }]);
  assert.equal(allowedControl({ type: 'todo', value: '买米' }, '不要修改我的待办'), false);
  assert.equal(allowedControl({ type: 'command', value: 'focus:start' }, '开始游戏'), false);
  const payload = Buffer.from('data: {"choices":[{"delta":{"content":"鲸鲸"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  const body = new ReadableStream({ start(controller) { for (const byte of payload) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const decoded = []; for await (const packet of readSSE(body)) decoded.push(packet);
  assert.equal(decoded[0].choices[0].delta.content, '鲸鲸', 'UTF-8 and SSE survive byte fragmentation');
  console.log('PASS fragmented SSE / split reasoning and tags / sentence boundaries');

  const store = createConfigStore({ directory: sandbox, safeStorage });
  assert.throws(() => endpoint('http://example.com/v1'));
  assert.throws(() => endpoint('http://192.168.1.1:9880', true));
  assert.throws(() => endpoint('https://user:password@example.com/v1'));
  assert.throws(() => store.save({ apiKey: 'bad\nkey' }));
  store.save({ baseURL: 'https://example.com/v1', model: 'fixture', apiKey: 'fixture-secret-17' });
  assert(!JSON.stringify(store.read()).includes('fixture-secret'));
  assert(!fs.readFileSync(path.join(sandbox, 'chat-config.json'), 'utf8').includes('fixture-secret'));
  assert.equal(store.privateConfig().apiKey, 'fixture-secret-17');
  store.save({ baseURL: 'https://another.example.com/v1' });
  assert.equal(store.read().hasKey, false, 'Endpoint changes remove the previous credential');
  const unavailable = createConfigStore({ directory: path.join(sandbox, 'unavailable'), safeStorage: { ...safeStorage, isEncryptionAvailable: () => false } });
  assert.throws(() => unavailable.save({ apiKey: 'never-save-me' }));
  assert(!fs.existsSync(path.join(sandbox, 'unavailable', 'chat-config.json')));
  console.log('PASS encrypted credentials / endpoint isolation / fail-closed storage');

  const requests = [], sovitsRequests = [];
  let sovitsFail = false;
  const wav = fs.readFileSync(path.join(__dirname, 'voice-lab', 'dafeiyu-indextts2', 'calibration', 'A-recloned.wav'));
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === '/tts') {
      sovitsRequests.push(input);
      if (sovitsFail) { res.writeHead(503); res.end('unavailable'); }
      else { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(wav); }
      return;
    }
    requests.push(input);
    const user = input.messages.at(-1).content;
    if (user === 'error') { res.writeHead(401); res.end('fixture-secret-17'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    function packet(delta, finish_reason = null) {
      if (!res.destroyed) res.write('data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\r\n\r\n');
    }
    packet({ reasoning_content: 'SECRET_REASONING' });
    if (user === 'slow') {
      await pause(150); packet({ content: '迟到的回复。' });
    } else if (user === 'truncated') {
      packet({ content: '没有写完' }); res.end(); return;
    } else if (input.messages[0].content.startsWith('压缩')) {
      packet({ content: '用户喜欢玩游戏。' });
    } else {
      packet({ content: '<thi' }); await pause(5); packet({ content: 'nk>隐藏的思考</think>[action:da' });
      packet({ content: 'nce][todo:add:买米][focus:start]你好。' });
      await pause(35); packet({ content: '我们去玩游戏！' });
    }
    packet({}, 'stop'); res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseURL = 'http://127.0.0.1:' + server.address().port;
  const events = [], synthesis = [];
  const tts = { async synthesize(text, { signal }) { signal.throwIfAborted(); synthesis.push(text); await pause(5); signal.throwIfAborted(); return { bytes: wav, mime: 'audio/wav' }; } };
  const service = createChatService({ configStore: store, directory: sandbox, onEvent: e => events.push(e), tts });
  try {
    store.save({ baseURL: baseURL + '/v1', model: 'fixture', apiKey: 'fixture-secret-17', ttsEngine: 'edge', provider: 'qwen' });
    await service.start({ id: 'first', persona: 'jingjing', text: '你好' }).done;
    assert.equal(events.filter(e => e.type === 'delta').map(e => e.text).join(''), '你好。我们去玩游戏！');
    assert(!JSON.stringify(events).includes('SECRET_REASONING') && !JSON.stringify(events).includes('隐藏的思考'));
    assert.deepEqual(synthesis, ['你好。', '我们去玩游戏！']);
    assert.deepEqual(events.filter(e => e.type === 'control').map(e => e.control), [{ type: 'action', value: 'dance' }], 'Unrequested task changes are blocked');
    assert(events.findIndex(e => e.type === 'audio') < events.findIndex(e => e.type === 'text-done'), 'First sentence audio arrives before the full text');
    assert.equal(requests[0].enable_thinking, false);
    assert.equal(service.memory('jingjing').turns.length, 1);
    assert.equal(service.memory('xiaoxiao').turns.length, 0);
    await service.start({ id: 'second', persona: 'xiaoxiao', text: '帮我在待办记下买米，然后开始专注', muted: true }).done;
    assert(events.some(e => e.id === 'second' && e.type === 'control' && e.control.type === 'todo'));
    assert(events.some(e => e.id === 'second' && e.type === 'control' && e.control.value === 'focus:start'));
    assert(!events.some(e => e.id === 'second' && e.type === 'audio'), 'Mute skips TTS requests');
    assert(requests[1].messages[0].content.includes('你是小小'));
    assert(!requests[1].messages.some(m => m.role === 'assistant'), 'Character histories do not cross');
    console.log('PASS HTTP streaming / reasoning isolation / early sentence audio / personas / controls / mute');

    const slow = service.start({ id: 'slow', persona: 'jingjing', text: 'slow' });
    await pause(25); service.cancel(); await slow.done;
    assert(events.some(e => e.id === 'slow' && e.type === 'cancelled'));
    assert(!events.some(e => e.id === 'slow' && e.type === 'delta'));
    assert.equal(service.memory('jingjing').turns.length, 1, 'Cancelled replies are not saved');
    await service.start({ id: 'error', persona: 'jingjing', text: 'error' }).done;
    assert(events.some(e => e.id === 'error' && e.type === 'error' && e.message.includes('密钥')));
    assert(!JSON.stringify(events).includes('fixture-secret-17'));
    await service.start({ id: 'truncated', persona: 'jingjing', text: 'truncated', muted: true }).done;
    assert(events.some(e => e.id === 'truncated' && e.type === 'error'));
    assert.equal(service.memory('jingjing').turns.length, 1);
    service.clearMemory('jingjing');
    assert.equal(service.memory('jingjing').turns.length, 0);
    assert.equal(service.memory('xiaoxiao').turns.length, 1);
    console.log('PASS cancellation / incomplete stream / sanitized errors / separate memory clearing');

    const memories = createMemoryStore(path.join(sandbox, 'versioned'));
    const snap = memories.append('jingjing', '喜欢游戏', '记住啦');
    memories.clear('jingjing');
    assert.equal(memories.summarize('jingjing', '旧摘要', snap.version, 1), false, 'Clear cannot be undone by an old summary');
    for (let i = 0; i < 21; i++) memories.append('xiaoxiao', '游戏' + i, '好的');
    const longStore = createConfigStore({ directory: path.join(sandbox, 'versioned'), safeStorage });
    longStore.save({ baseURL: baseURL + '/v1', model: 'fixture', ttsEngine: 'off' });
    const summaryService = createChatService({ configStore: longStore, directory: path.join(sandbox, 'versioned'), onEvent() {} });
    await summaryService.start({ id: 'summary', persona: 'xiaoxiao', text: '你好' }).done;
    for (let i = 0; i < 40 && !summaryService.memory('xiaoxiao').summary; i++) await pause(10);
    assert(summaryService.memory('xiaoxiao').summary.includes('玩游戏'));
    assert.equal(summaryService.memory('xiaoxiao').turns.length, 16);
    summaryService.cancel();
    console.log('PASS bounded recent memory / asynchronous summary / clear version protection');

    const liveTTS = createTTSService();
    const cloned = await liveTTS.synthesize('你好。', { persona: 'jingjing', config: { ...store.read(), ttsEngine: 'sovits', sovitsURL: baseURL, refAudioPath: 'D:\\fixture.wav', refText: '参考原文', edgeFallback: false }, signal: new AbortController().signal });
    assert.equal(cloned.mime, 'audio/wav'); assert.equal(cloned.bytes.length, wav.length);
    assert.equal(sovitsRequests[0].streaming_mode, false);
    sovitsFail = true;
    await assert.rejects(liveTTS.synthesize('你好。', { persona: 'jingjing', config: { ...store.read(), ttsEngine: 'sovits', sovitsURL: baseURL, refAudioPath: 'D:\\fixture.wav', refText: '参考原文', edgeFallback: false }, signal: new AbortController().signal }));
    console.log('PASS GPT-SoVITS API contract / WAV validation / explicit fallback policy');

    const handlers = new Map(), listeners = new Map(), frame = {}, wc = { mainFrame: frame, send() {} };
    const backend = registerChatIPC({ ipcMain: { handle: (key, fn) => handlers.set(key, fn), on: (key, fn) => listeners.set(key, fn) },
      safeStorage, directory: () => path.join(sandbox, 'ipc'), getWindow: () => ({ isDestroyed: () => false, webContents: wc, isVisible: () => true, isMinimized: () => false }) });
    const bad = await handlers.get('config:save')({ sender: {}, senderFrame: frame }, { apiKey: 'bad' });
    assert.equal(bad.ok, false);
    assert.equal((await handlers.get('config:get')({ sender: wc, senderFrame: {} })).ok, false);
    const trusted = { sender: wc, senderFrame: frame };
    assert.equal((await handlers.get('config:get')(trusted)).ok, true);
    assert.equal((await handlers.get('chat:send')(trusted, { id: 'bad', persona: '../../file', text: 'x' })).ok, false);
    assert.equal((await handlers.get('chat:send')(trusted, { id: 'bad', persona: 'jingjing', text: 'x'.repeat(2001) })).ok, false);
    backend.cancel();
    console.log('PASS IPC sender/frame checks / text and persona validation');
  } finally {
    service.cancel(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().then(() => console.log('ALL CHAT CHECKS PASSED')).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  const resolved = path.resolve(sandbox);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('todo-widget-chat-')) fs.rmSync(resolved, { recursive: true, force: true });
});
