/* Small, explicit interactions. One audio player and one microphone session. */
window.createPetInteractions = function ({ say, onCommand, onMood }) {
  const mascot = document.getElementById('mascot');
  const art = document.getElementById('characterArt');
  const status = document.getElementById('petStatus');
  const mic = document.getElementById('petMic');
  const sound = document.getElementById('petSound');
  const rest = document.getElementById('petRest');
  const particles = document.getElementById('petParticles');
  const voice = new Audio();
  voice.preload = 'auto';
  voice.volume = .55;
  const poses = { idle: 'assets/xiaolan.png', wave: 'assets/xiaolan-wave.png', pat: 'assets/xiaolan-pat.png', sleep: 'assets/xiaolan-sleep.png' };
  Object.values(poses).forEach(src => { const image = new Image(); image.src = src; });
  const dialogue = window.PetDialogue;
  let muted = localStorage.getItem('xiaolan-muted') === 'true';
  let action = 'idle', baseMood = 'idle', sleeping = false, actionTimer;
  let listening = false, supported = false, micRun = 0, playbackRun = 0;
  let currentLine = '', previousLines = new Map();

  function setPose(pose) {
    if (art.getAttribute('src') !== poses[pose]) art.src = poses[pose];
    document.getElementById('petFallback').hidden = true;
  }
  function paintStatus() {
    const label = listening ? (mic.dataset.state === 'listening' ? '· 正在听你说' : '· 麦克风准备中')
      : !voice.paused ? '· 大肥鱼在说话' : sleeping ? '· 小憩中' : '';
    if (label) status.textContent = label;
    return label;
  }
  function stopVoice() {
    playbackRun++;
    voice.pause();
    voice.currentTime = 0;
    mascot.classList.remove('talking');
  }
  function paintSound() {
    sound.classList.toggle('muted', muted);
    sound.setAttribute('aria-pressed', String(!muted));
    sound.title = muted ? '声音已关闭 · 点击开启' : '声音已开启 · 点击静音';
    sound.setAttribute('aria-label', sound.title);
  }
  function paintMic(state) {
    mic.dataset.state = state;
    mic.classList.toggle('listening', listening);
    mic.setAttribute('aria-pressed', String(listening));
    mic.querySelector('span').textContent = listening ? '停止听' : '说句话';
    paintStatus();
  }
  function cancelListen() {
    if (!listening) return;
    micRun++;
    listening = false;
    window.widget.cancelVoice?.();
    paintMic('idle');
  }
  function resetPose() {
    action = sleeping ? 'sleep' : 'idle';
    mascot.dataset.action = action;
    mascot.classList.remove('boing');
    setPose(sleeping || baseMood === 'sleep' ? 'sleep' : 'idle');
    rest.querySelector('span').textContent = sleeping ? '叫醒她' : '休息';
    rest.setAttribute('aria-label', sleeping ? '叫醒大肥鱼' : '让大肥鱼休息');
  }
  function burst(kind) {
    particles.replaceChildren();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let index = 0; index < 6; index++) {
      const mote = document.createElement('i');
      mote.textContent = kind === 'pat' ? '♥' : '✦';
      mote.style.cssText = `--x:${-68 + index * 27}px;--delay:${index * .065}s;--r:${index % 2 ? 22 : -18}deg`;
      particles.append(mote);
      setTimeout(() => mote.remove(), 1800);
    }
  }
  function animate(next) {
    clearTimeout(actionTimer);
    action = next;
    sleeping = next === 'sleep';
    mascot.classList.remove('boing');
    mascot.dataset.action = '';
    void mascot.offsetWidth;
    mascot.dataset.action = next;
    if (next !== 'sleep') mascot.classList.add('boing');
    setPose(next === 'dance' ? 'wave' : next);
    if (next !== 'sleep') burst(next);
    rest.querySelector('span').textContent = sleeping ? '叫醒她' : '休息';
    rest.setAttribute('aria-label', sleeping ? '叫醒大肥鱼' : '让大肥鱼休息');
    if (next !== 'sleep') actionTimer = setTimeout(resetPose, next === 'dance' ? 5200 : 3200);
    onMood(next === 'sleep' ? 'sleep' : 'happy', next === 'dance' ? 5200 : 3200);
  }
  function choose(id) {
    const candidates = dialogue.filter(line => line.id === id || line.id.startsWith(id + '-'));
    const other = candidates.filter(line => line.id !== previousLines.get(id));
    const pool = other.length ? other : candidates;
    const selected = pool[Math.floor(Math.random() * pool.length)];
    if (selected) previousLines.set(id, selected.id);
    return selected;
  }
  function respond(id) {
    const line = choose(id);
    if (!line) return false;
    cancelListen();
    stopVoice();
    currentLine = line.text;
    onCommand(id);
    animate(line.action);
    say(line.text, 8500);
    if (!muted) {
      const run = playbackRun;
      voice.src = `assets/voice-dafeiyu/${line.id}.mp3`;
      voice.play().then(() => {
        if (run !== playbackRun) return;
        mascot.classList.add('talking');
        paintStatus();
      }).catch(() => {
        if (run !== playbackRun) return;
        mascot.classList.remove('talking');
        say(line.text + '（声音暂时无法播放）', 8500);
      });
    }
    paintStatus();
    return true;
  }
  voice.addEventListener('ended', () => mascot.classList.remove('talking'));
  voice.addEventListener('loadedmetadata', () => {
    if (currentLine && !voice.paused) say(currentLine, Math.max(6500, voice.duration * 1000 + 1500));
  });
  voice.addEventListener('error', () => {
    mascot.classList.remove('talking');
    if (!muted && currentLine) say(currentLine + '（声音文件未能播放）', 8500);
  });

  async function listen() {
    if (listening) { cancelListen(); say('这次先不听啦。想聊时再点麦克风。'); return; }
    if (!supported) { say('语音还没准备好。请用“启动便签”启动我，也可以先点按钮玩。', 6500); return; }
    stopVoice();
    clearTimeout(actionTimer);
    sleeping = false;
    resetPose();
    listening = true;
    const run = ++micRun;
    paintMic('preparing');
    say('正在准备麦克风，亮起后说一句就好。', 15000);
    let result;
    try { result = await window.widget.listenVoice(); }
    catch (_) { result = { status: 'unavailable' }; }
    if (run !== micRun) return;
    listening = false;
    paintMic('idle');
    if (result.status === 'recognized' && respond(result.id)) return;
    if (result.detail) mic.title = '语音错误：' + result.detail;
    const messages = {
      'no-speech': '没听到呢。再点麦克风，说“你好”或“跳个舞”吧。',
      unclear: '没听清呢。可以说“跳个舞”“开始专注”或“打开清单”。',
      cancelled: '已经停止聆听啦。',
      timeout: '这次没有听清，麦克风已关闭。再试一次吧。',
      busy: '麦克风还在结束上一句，请稍后再试。'
    };
    say(messages[result.status] || (result.stage === 'engine-create' ? '语音识别引擎暂时不可用，请用“启动便签”重新启动。' : '麦克风没能打开，请检查 Windows 麦克风权限和输入设备。'), 8000);
  }
  window.widget.onVoiceState?.(state => {
    if (!listening || !['preparing', 'listening'].includes(state)) return;
    paintMic(state);
    if (state === 'listening') say('我在听，说“你好”“跳个舞”或“开始专注”吧。', 12000);
  });
  Promise.resolve(window.widget.getVoiceSupport?.()).then(result => {
    supported = !!result?.supported;
    mic.disabled = false;
    mic.title = supported ? '点击听一句，最长 8 秒；再点停止。支持：大肥鱼、蒂普斯克、吃白米饭、鲸鲸、玩游戏、跳个舞、开始专注、暂停专注、打开清单、你是谁' : '中文语音识别暂不可用，点击查看说明';
    mic.classList.toggle('unavailable', !supported);
  }).catch(() => { mic.disabled = false; mic.title = '语音识别暂不可用'; });
  document.getElementById('petPat').onclick = () => respond('pat');
  document.getElementById('petDance').onclick = () => respond('dance');
  rest.onclick = () => respond(sleeping ? 'wake' : 'sleep');
  mic.onclick = listen;
  sound.onclick = () => {
    muted = !muted;
    localStorage.setItem('xiaolan-muted', String(muted));
    paintSound();
    if (muted) { stopVoice(); say('声音关掉啦，大肥鱼会安静地陪你。'); }
    else respond('hello');
  };
  const quiet = () => { cancelListen(); stopVoice(); };
  window.widget.onDragging?.(quiet);
  window.widget.onGhost?.(on => { if (on) quiet(); });
  window.widget.onSuspend?.(quiet);
  document.addEventListener('visibilitychange', () => { if (document.hidden) quiet(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && listening) { cancelListen(); say('已经停止聆听啦。'); } });
  window.addEventListener('pagehide', quiet);
  paintSound();
  resetPose();
  return {
    click(event) {
      if (sleeping) return respond('wake');
      const bounds = mascot.getBoundingClientRect();
      respond(event.detail === 0 || (event.clientY - bounds.top) / bounds.height < .46 ? 'pat' : 'poke');
    },
    status: paintStatus,
    syncMood(mood) { baseMood = mood; if (action === 'idle') resetPose(); },
    respond
  };
};
