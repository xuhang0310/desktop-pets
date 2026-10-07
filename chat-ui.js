window.createChatUI = function ({ companion, openPanel, closePanel }) {
  const api = window.petChat;
  const panel = document.createElement('section');
  panel.id = 'chatPanel'; panel.className = 'chat-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', '和桌面伙伴聊天'); panel.setAttribute('data-interactive', '');
  // This template is static. Model text, memory and errors always use textContent.
  panel.innerHTML = `
    <header class="chat-heading"><div><small>在你身边</small><strong id="chatTitle">和鲸鲸聊一聊</strong></div>
      <div class="chat-head-buttons"><button id="chatSettings" aria-label="聊天设置" title="聊天设置">⚙</button><button id="chatClose" aria-label="收起聊天" title="收起聊天">×</button></div></header>
    <div id="chatConversation" class="chat-conversation">
      <div id="chatMessages" class="chat-messages" role="log" aria-label="对话记录"></div>
      <p id="chatNotice" class="chat-notice" role="status"></p>
      <form id="chatComposer" class="chat-composer"><label class="sr-only" for="chatInput">想对伙伴说的话</label>
        <textarea id="chatInput" rows="2" maxlength="2000" placeholder="今天想聊点什么？"></textarea>
        <div class="chat-composer-foot"><small>Enter 发送 · Shift+Enter 换行</small><button id="chatStop" type="button" hidden>停止</button><button id="chatSend" type="submit">发送 ↗</button></div>
      </form>
    </div>
    <form id="chatConfigForm" class="chat-config" hidden>
      <p class="chat-settings-intro">连接你的模型服务，让伙伴自由聊天。</p>
      <label>服务商<select id="chatProvider"><option value="custom">其他兼容接口</option><option value="qwen">千问 · 阿里云</option><option value="deepseek">DeepSeek</option></select></label>
      <label>服务地址<input id="chatBaseURL" type="url" placeholder="https://…/v1" autocomplete="off"></label>
      <label>模型名<input id="chatModel" placeholder="填写服务商提供的模型名" maxlength="160" autocomplete="off"></label>
      <label>API Key<input id="chatApiKey" type="password" placeholder="输入新密钥" autocomplete="new-password" spellcheck="false"></label>
      <label class="chat-check"><input id="chatClearKey" type="checkbox">移除已保存的密钥</label>
      <label>思考模式<select id="chatThinking"><option value="off">关闭 · 日常聊天</option><option value="auto">自动 · 分析问题时开启</option><option value="on">开启 · 可能需要多等一会儿</option></select></label>
      <small class="chat-field-help">千问和 DeepSeek 可切换思考；其他接口使用服务商默认模式。</small>
      <label>实时回复声音<select id="chatTTS"><option value="edge">在线自然女声</option><option value="sovits">鲸鲸复刻 · 本地 GPT-SoVITS</option><option value="off">只显示文字</option></select></label>
      <small class="chat-field-help">点击互动仍播放已确认的 A 版样本。在线女声会把回复文字发给语音服务，音色与 A 版不同。</small>
      <div id="chatSovitsFields" hidden>
        <label>本地语音地址<input id="chatSovitsURL" placeholder="http://127.0.0.1:9880"></label>
        <label>鲸鲸参考音频路径<input id="chatRefAudio" placeholder="参考 WAV 的完整路径"></label>
        <label>参考音频原文<textarea id="chatRefText" rows="2" maxlength="1000"></textarea></label>
        <label class="chat-check"><input id="chatFallback" type="checkbox">本地服务离线时，改用在线女声</label>
        <small class="chat-field-help">需先启动已准备好的 GPT-SoVITS 服务。小小继续使用自己的在线女声。</small>
      </div>
      <label id="chatPythonLabel">语音使用的 Python<input id="chatPython" placeholder="python 或完整 python.exe 路径"></label>
      <label class="chat-check"><input id="chatRemember" type="checkbox">记住最近的对话和摘要</label>
      <div class="chat-memory-tools"><button id="chatClearMemory" type="button">清空当前伙伴的记忆</button><small id="chatMemoryHint">鲸鲸和小小分别记忆</small></div>
      <p id="chatConfigNotice" class="chat-notice" role="status"></p>
      <div class="chat-save-row"><button id="chatSettingsBack" type="button">返回聊天</button><button id="chatSave" type="submit">保存设置</button></div>
    </form>`;
  document.body.appendChild(panel);
  const el = id => panel.querySelector('#' + id);
  const opener = document.getElementById('petChatOpen');
  const input = el('chatInput'), messages = el('chatMessages');
  const audio = new Audio(); audio.volume = .55; audio.preload = 'auto';
  let opened = false, previousCollapsed = true, current = null, config = null;
  let audioQueue = [], playing = null, audioContext, analyser, mediaSource, meterFrame, samples;
  let loadVersion = 0, audioVersion = 0;

  function initMeter() {
    try {
      if (!audioContext) {
        audioContext = new AudioContext(); analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
        samples = new Uint8Array(analyser.fftSize);
        mediaSource = audioContext.createMediaElementSource(audio);
        mediaSource.connect(analyser); analyser.connect(audioContext.destination);
      }
      void audioContext.resume().catch(() => {});
    } catch { /* Playback also works without the optional volume animation. */ }
  }
  function meter() {
    if (!playing) return;
    let level = .08;
    if (analyser) {
      analyser.getByteTimeDomainData(samples);
      level = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
    }
    companion.setChatTalking(level);
    meterFrame = requestAnimationFrame(meter);
  }
  function release(item) { if (item?.url) URL.revokeObjectURL(item.url); }
  function stopAudio() {
    audioVersion++; cancelAnimationFrame(meterFrame); audio.pause(); audio.removeAttribute('src'); audio.load();
    release(playing); playing = null;
    audioQueue.forEach(release); audioQueue = [];
    companion.setChatTalking(0);
  }
  function refreshBusy() {
    const busy = !!current && (!current.done || playing || audioQueue.length);
    el('chatStop').hidden = !busy;
    panel.classList.toggle('is-busy', busy);
    if (!busy) { companion.setChatState(''); if (current) current = null; }
  }
  function playNext() {
    if (playing || !current || companion.isMuted()) return;
    const item = audioQueue.shift();
    if (!item) { refreshBusy(); return; }
    if (item.id !== current.id) { release(item); playNext(); return; }
    const version = audioVersion;
    playing = item; audio.src = item.url;
    companion.setChatState('speaking');
    audio.play().then(() => { if (version === audioVersion && playing === item) meter(); }).catch(() => {
      if (version !== audioVersion || playing !== item) return;
      notice('声音暂时无法播放，可以继续阅读文字。');
      finishAudio();
    });
  }
  function finishAudio() {
    cancelAnimationFrame(meterFrame); companion.setChatTalking(0);
    release(playing); playing = null; playNext(); refreshBusy();
  }
  audio.addEventListener('ended', finishAudio);
  audio.addEventListener('error', () => { if (playing) { notice('声音暂时无法播放，可以继续阅读文字。'); finishAudio(); } });
  function notice(text) { el('chatNotice').textContent = text || ''; }
  function scroll() { messages.scrollTop = messages.scrollHeight; }
  function message(role, text) {
    const row = document.createElement('div'); row.className = 'chat-message ' + role;
    const label = document.createElement('small'); label.textContent = role === 'user' ? '你' : companion.characterName();
    const body = document.createElement('p'); body.textContent = text;
    row.append(label, body); messages.appendChild(row);
    while (messages.children.length > 48) messages.firstElementChild.remove();
    scroll(); return { row, body };
  }
  function empty() {
    const note = document.createElement('div'); note.className = 'chat-empty';
    const icon = document.createElement('span'); icon.textContent = '◌';
    const title = document.createElement('strong'); title.textContent = '今天，想和' + companion.characterName() + '聊什么？';
    const hint = document.createElement('p'); hint.textContent = '分享一件小事，或者一起想想下一步。';
    note.append(icon, title, hint); messages.appendChild(note);
  }
  function cancel(send = true) {
    if (send) api?.cancel();
    stopAudio(); companion.setChatState('');
    if (current) {
      current.row.classList.remove('pending');
      if (!current.reply) current.body.textContent = '这次先停在这里。';
      current = null;
    }
    refreshBusy();
  }
  async function loadMemory() {
    const version = ++loadVersion, persona = companion.characterId();
    let result;
    try { result = await api?.getMemory(persona); }
    catch { notice('请重新启动桌面伙伴以启用聊天。'); }
    if (version !== loadVersion || persona !== companion.characterId() || current) return;
    messages.replaceChildren();
    if (result?.ok && result.data.turns.length) {
      result.data.turns.forEach(turn => { message('user', turn.user); message('assistant', turn.assistant); });
    } else empty();
  }
  function open() {
    if (!opened) {
      opened = true; previousCollapsed = openPanel(); panel.hidden = false;
      document.body.classList.add('chat-open'); opener.setAttribute('aria-expanded', 'true');
      if (!current) void loadMemory();
    }
    el('chatConfigForm').hidden = true; el('chatConversation').hidden = false;
    input.focus();
    if (!api) notice('请重新启动桌面伙伴以启用聊天。');
  }
  function close(restore = true) {
    if (!opened) return;
    cancel(); loadVersion++; opened = false; panel.hidden = true;
    document.body.classList.remove('chat-open'); opener.setAttribute('aria-expanded', 'false');
    if (restore) closePanel(previousCollapsed);
    opener.focus();
  }
  async function send(event) {
    event?.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (!api) { notice('请重新启动桌面伙伴以启用聊天。'); return; }
    cancel(); loadVersion++; initMeter(); companion.prepareChat();
    messages.querySelector('.chat-empty')?.remove();
    const user = message('user', text), response = message('assistant', '正在想一句回复…');
    response.row.classList.add('pending');
    const id = crypto.randomUUID(), persona = companion.characterId();
    current = { id, persona, ...response, reply: '', done: false };
    input.value = ''; notice(''); refreshBusy(); companion.setChatState('waiting');
    let result;
    try { result = await api.send({ id, persona, text, muted: companion.isMuted() }); }
    catch { result = { ok: false, message: '聊天未能启动，请重新启动桌面伙伴。' }; }
    if (current?.id !== id) return;
    if (!result.ok) {
      user.row.remove(); response.row.remove(); current = null; input.value = text;
      companion.setChatState(''); refreshBusy(); notice(result.message);
      if (!messages.children.length) empty();
    }
  }
  api?.onEvent(event => {
    if (!current || event.id !== current.id || event.persona !== current.persona || event.persona !== companion.characterId()) return;
    if (event.type === 'delta') {
      current.reply += event.text; current.body.textContent = current.reply;
      current.row.classList.remove('pending'); scroll();
      companion.setChatState(playing ? 'speaking' : '');
      companion.say(current.reply.slice(-100), 15000);
    } else if (event.type === 'state') {
      companion.setChatState(event.state);
      current.body.textContent = event.state === 'thinking' ? '正在认真想一想…' : '正在想一句回复…';
    } else if (event.type === 'control') companion.control(event.control);
    else if (event.type === 'audio' && !companion.isMuted()) {
      const url = URL.createObjectURL(new Blob([event.bytes], { type: event.mime }));
      audioQueue.push({ id: event.id, url }); playNext();
    } else if (event.type === 'warning') notice(event.message);
    else if (event.type === 'done') {
      current.done = true; current.row.classList.remove('pending'); refreshBusy();
    } else if (event.type === 'error') { notice(event.message); cancel(false); }
    else if (event.type === 'cancelled') cancel(false);
  });
  function voiceFields() {
    el('chatSovitsFields').hidden = el('chatTTS').value !== 'sovits';
    el('chatPythonLabel').hidden = el('chatTTS').value === 'off';
  }
  async function settings() {
    cancel(); open(); el('chatConversation').hidden = true; el('chatConfigForm').hidden = false;
    el('chatConfigNotice').textContent = '';
    let result;
    try { result = await api?.getConfig(); }
    catch { result = { ok: false, message: '请重新启动桌面伙伴以启用聊天设置。' }; }
    if (!result?.ok) { el('chatConfigNotice').textContent = result?.message || '请重新启动伙伴以加载设置。'; return; }
    config = result.data;
    const fields = { chatProvider: 'provider', chatBaseURL: 'baseURL', chatModel: 'model', chatThinking: 'thinking',
      chatTTS: 'ttsEngine', chatSovitsURL: 'sovitsURL', chatRefAudio: 'refAudioPath', chatRefText: 'refText', chatPython: 'pythonPath' };
    for (const [id, key] of Object.entries(fields)) el(id).value = config[key];
    el('chatFallback').checked = config.edgeFallback; el('chatRemember').checked = config.remember;
    el('chatApiKey').value = ''; el('chatApiKey').placeholder = config.hasKey ? '已加密保存；留空保留原密钥' : '输入新密钥';
    el('chatClearKey').checked = false; voiceFields();
    if (config.loadError) el('chatConfigNotice').textContent = '旧设置未能读取，请重新填写并保存。';
    el('chatProvider').focus();
  }
  el('chatConfigForm').onsubmit = async event => {
    event.preventDefault(); if (!api) return;
    const button = el('chatSave'); button.disabled = true;
    const key = el('chatApiKey').value; el('chatApiKey').value = '';
    let result;
    try {
      result = await api.saveConfig({ provider: el('chatProvider').value, baseURL: el('chatBaseURL').value,
        model: el('chatModel').value, apiKey: key, clearKey: el('chatClearKey').checked, thinking: el('chatThinking').value,
        ttsEngine: el('chatTTS').value, sovitsURL: el('chatSovitsURL').value, refAudioPath: el('chatRefAudio').value,
        refText: el('chatRefText').value, pythonPath: el('chatPython').value,
        edgeFallback: el('chatFallback').checked, remember: el('chatRemember').checked });
    } catch { result = { ok: false, message: '设置未能保存，请重试。' }; }
    finally { button.disabled = false; }
    el('chatConfigNotice').textContent = result.ok ? '设置已保存。可以返回聊天了。' : result.message;
    if (result.ok) { config = result.data; el('chatApiKey').placeholder = config.hasKey ? '已加密保存；留空保留原密钥' : '输入新密钥'; }
  };
  el('chatProvider').onchange = () => {
    const presets = { qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'], deepseek: ['https://api.deepseek.com/v1', ''] };
    const preset = presets[el('chatProvider').value];
    if (preset) { el('chatBaseURL').value = preset[0]; el('chatModel').value = preset[1]; }
    el('chatApiKey').placeholder = '服务地址改变后需重新输入密钥';
  };
  el('chatClearMemory').onclick = async () => {
    cancel(); let result;
    try { result = await api?.clearMemory(companion.characterId()); }
    catch { result = { ok: false, message: '请重新启动伙伴后再试。' }; }
    if (result?.ok) { await loadMemory(); el('chatMemoryHint').textContent = companion.characterName() + '的记忆已清空'; }
    else el('chatMemoryHint').textContent = result?.message || '请重新启动伙伴后再试。';
  };
  el('chatTTS').onchange = voiceFields;
  el('chatSettings').onclick = settings;
  el('chatSettingsBack').onclick = open;
  el('chatClose').onclick = () => close();
  el('chatStop').onclick = () => { cancel(); notice('已停止。想聊时可以继续发送。'); };
  el('chatComposer').onsubmit = send;
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
  });
  opener.onclick = () => opened ? close() : open();
  document.addEventListener('pet:interrupt', () => cancel());
  document.addEventListener('pet:mute', () => cancel());
  document.addEventListener('pet:character', () => {
    cancel(); loadVersion++; el('chatTitle').textContent = '和' + companion.characterName() + '聊一聊';
    input.value = ''; notice(''); el('chatApiKey').value = '';
    el('chatMemoryHint').textContent = '鲸鲸和小小分别记忆';
    if (opened) { open(); void loadMemory(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopImmediatePropagation(); close(); }
  }, true);
  window.widget.onSuspend?.(() => cancel());
  window.addEventListener('pagehide', () => { cancel(); void audioContext?.close(); });
  el('chatTitle').textContent = '和' + companion.characterName() + '聊一聊'; empty();
  return { close, cancel };
};
