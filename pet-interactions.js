/* Small, explicit interactions. One audio player and one microphone session. */
window.createPetInteractions = function ({ say, onCommand, onMood, onCharacterChange = () => {} }) {
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
  const skins = {
    anime: {
      name: '鲸鲸', fullName: '大肥鱼（蒂普斯克）', headRatio: .46,
      dialogue: window.PetDialogue, voiceDirectory: 'assets/voice-dafeiyu-indextts2-a',
      greeting: '鲸鲸回来啦！吃白米饭，今天想玩什么游戏？',
      alt: '蓝发蓝眼睛、戴白色发饰、穿深蓝裙装的大肥鱼',
      poses: { idle: 'assets/xiaolan.png', wave: 'assets/xiaolan-wave.png', pat: 'assets/xiaolan-pat.png', sleep: 'assets/xiaolan-sleep.png' }
    },
    realistic: {
      name: '小小', fullName: '小小', headRatio: .44,
      dialogue: window.HumanDialogue, voiceDirectory: 'assets/voice-human',
      greeting: '你好，我是小小。很高兴见到你，今天想做些什么？',
      alt: '小小：约20岁的东方成年女性半身像，长卷发、黑色上衣，不戴首饰',
      // This independent character uses one portrait with subtle movements.
      poses: { idle: 'assets/human-selected-black.png' }
    }
  };
  const savedSkin = localStorage.getItem('dafeiyu-appearance');
  let skin = Object.hasOwn(skins, savedSkin) ? savedSkin : 'anime';
  let currentPose = 'idle', skinRun = 0;
  const appearanceButton = document.getElementById('petAppearance');
  const appearancePanel = document.getElementById('appearancePanel');
  Object.values(skins).flatMap(item => Object.values(item.poses)).forEach(src => { const image = new Image(); image.src = src; });
  let muted = localStorage.getItem('xiaolan-muted') === 'true';
  let action = 'idle', baseMood = 'idle', sleeping = false, actionTimer;
  let listening = false, supported = false, micRun = 0, playbackRun = 0;
  let currentLine = '', previousLines = new Map(), chatState = '';
  const interruptChat = () => document.dispatchEvent(new CustomEvent('pet:interrupt'));

  function setPose(pose) {
    currentPose = pose;
    const selected = skins[skin];
    const src = selected.poses[pose] || selected.poses.idle;
    if (art.getAttribute('src') !== src) art.src = src;
    art.alt = selected.alt;
    document.getElementById('petFallback').hidden = true;
  }
  function paintSkin() {
    const name = skins[skin].name;
    document.body.dataset.skin = skin;
    mascot.dataset.skin = skin;
    document.getElementById('petName').textContent = name;
    document.title = name + ' · 桌面陪伴';
    document.querySelector('.companion').setAttribute('aria-label', name + '桌面伙伴');
    document.querySelector('.pet-actions').setAttribute('aria-label', '和' + name + '互动');
    mascot.title = '按住' + name + '拖动，轻点互动，双击打开清单';
    mascot.setAttribute('aria-label', mascot.title);
    document.getElementById('petPat').setAttribute('aria-label', '摸摸' + name + '的头');
    document.getElementById('petDance').setAttribute('aria-label', '让' + name + '跳个舞');
    document.getElementById('btnClose').setAttribute('aria-label', '收起' + name);
    document.getElementById('btnClose').title = '收起' + name + '（任务栏或托盘唤回）';
    document.querySelector('.drag-handle').title = '按住此条拖动' + name;
    appearanceButton.title = '当前：' + name + ' · 点击切换伙伴';
    paintMicHelp();
    appearancePanel.querySelectorAll('[data-skin-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.skinChoice === skin));
    });
    setPose(currentPose);
  }
  function closeAppearance(restoreFocus = false) {
    appearancePanel.hidden = true;
    appearanceButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) appearanceButton.focus();
  }
  async function selectSkin(id) {
    if (!Object.hasOwn(skins, id)) return;
    const run = ++skinRun;
    const next = new Image();
    next.src = skins[id].poses.idle;
    try { await next.decode(); }
    catch (_) {
      if (run === skinRun) say('这个形象暂时没加载好，请稍后再试。');
      return;
    }
    if (run !== skinRun) return;
    quiet();
    clearTimeout(actionTimer);
    action = 'idle';
    sleeping = false;
    currentPose = 'idle';
    currentLine = '';
    particles.replaceChildren();
    skin = id;
    localStorage.setItem('dafeiyu-appearance', skin);
    paintSkin();
    resetPose();
    onCharacterChange();
    document.dispatchEvent(new CustomEvent('pet:character', { detail: { persona: skin === 'anime' ? 'jingjing' : 'xiaoxiao' } }));
    closeAppearance(true);
    say(skins[skin].greeting, 5500);
  }
  function paintStatus() {
    const label = listening ? (mic.dataset.state === 'listening' ? '· 正在听你说' : '· 麦克风准备中')
      : chatState === 'thinking' ? '· 正在想一想' : chatState === 'waiting' ? '· 正在等回复'
      : chatState === 'speaking' || !voice.paused ? '· 正在说话' : sleeping ? '· 小憩中' : '';
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
  function paintMicHelp() {
    const names = skin === 'realistic' ? '小小、小小你好' : '大肥鱼、蒂普斯克、吃白米饭、鲸鲸';
    mic.title = supported ? '点击听一句，最长 8 秒；再点停止。支持：' + names + '、跳个舞、休息一下、开始专注、暂停专注、打开清单、你是谁' : '中文语音识别暂不可用，点击查看说明';
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
    rest.setAttribute('aria-label', sleeping ? '叫醒' + skins[skin].name : '让' + skins[skin].name + '休息');
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
    rest.setAttribute('aria-label', sleeping ? '叫醒' + skins[skin].name : '让' + skins[skin].name + '休息');
    if (next !== 'sleep') actionTimer = setTimeout(resetPose, next === 'dance' ? 5200 : 3200);
    onMood(next === 'sleep' ? 'sleep' : 'happy', next === 'dance' ? 5200 : 3200);
  }
  function choose(id) {
    const dialogue = skins[skin].dialogue;
    const key = skin + ':' + id;
    const candidates = dialogue.filter(line => line.id === id || line.id.startsWith(id + '-'));
    const other = candidates.filter(line => line.id !== previousLines.get(key));
    const pool = other.length ? other : candidates;
    const selected = pool[Math.floor(Math.random() * pool.length)];
    if (selected) previousLines.set(key, selected.id);
    return selected;
  }
  function respond(id) {
    const line = choose(id);
    if (!line) return false;
    interruptChat();
    cancelListen();
    stopVoice();
    currentLine = line.text;
    onCommand(id);
    animate(line.action);
    say(line.text, 8500);
    if (!muted) {
      const run = playbackRun;
      voice.src = `${skins[skin].voiceDirectory}/${line.id}.mp3`;
      mascot.dataset.voicePack = skin;
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
    interruptChat();
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
    paintMicHelp();
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
    document.dispatchEvent(new CustomEvent('pet:mute', { detail: { muted } }));
    if (muted) { stopVoice(); say('声音关掉了，我会安静地陪着你。'); }
    else respond('hello');
  };
  const quiet = () => { interruptChat(); cancelListen(); stopVoice(); };
  appearanceButton.onclick = () => {
    if (!appearancePanel.hidden) { closeAppearance(true); return; }
    quiet();
    appearancePanel.hidden = false;
    appearanceButton.setAttribute('aria-expanded', 'true');
    appearancePanel.querySelector('[aria-pressed="true"]').focus();
  };
  document.getElementById('appearanceClose').onclick = () => closeAppearance(true);
  appearancePanel.querySelectorAll('[data-skin-choice]').forEach(button => {
    button.onclick = () => selectSkin(button.dataset.skinChoice);
  });
  document.addEventListener('pointerdown', event => {
    if (!appearancePanel.hidden && !appearancePanel.contains(event.target) && !appearanceButton.contains(event.target)) closeAppearance();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !appearancePanel.hidden) {
      event.stopImmediatePropagation();
      event.preventDefault();
      closeAppearance(true);
    }
  }, true);
  window.widget.onDragging?.(quiet);
  window.widget.onGhost?.(on => { if (on) quiet(); });
  window.widget.onSuspend?.(quiet);
  document.addEventListener('visibilitychange', () => { if (document.hidden) quiet(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && listening) { cancelListen(); say('已经停止聆听啦。'); } });
  window.addEventListener('pagehide', quiet);
  paintSound();
  paintSkin();
  resetPose();
  return {
    click(event) {
      if (sleeping) return respond('wake');
      const bounds = mascot.getBoundingClientRect();
      respond(event.detail === 0 || (event.clientY - bounds.top) / bounds.height < skins[skin].headRatio ? 'pat' : 'poke');
    },
    status: paintStatus,
    characterName: () => skins[skin].name,
    characterId: () => skin === 'anime' ? 'jingjing' : 'xiaoxiao',
    isMuted: () => muted,
    say,
    animate,
    stopVoice,
    prepareChat() { cancelListen(); stopVoice(); clearTimeout(actionTimer); sleeping = false; resetPose(); },
    setChatState(state) {
      chatState = state || '';
      mascot.classList.toggle('thinking', ['thinking', 'waiting'].includes(state));
      if (!state) mascot.classList.remove('talking');
      paintStatus();
    },
    setChatTalking(level) { mascot.classList.toggle('talking', level > .018); mascot.style.setProperty('--speech-level', String(Math.min(level * 4, 1))); },
    control(tag) {
      if (tag.type === 'action' && ['pat', 'dance', 'sleep', 'wake', 'wave'].includes(tag.value)) animate(tag.value === 'wake' ? 'wave' : tag.value);
      else if (tag.type === 'command') {
        const id = { 'focus:start': 'focus', 'focus:pause': 'pause', 'list:open': 'open' }[tag.value];
        if (id) onCommand(id);
      } else if (tag.type === 'todo' && typeof tag.value === 'string' && tag.value.trim().length <= 160) onCommand('add', tag.value.trim());
    },
    idleText: count => skin === 'anime'
      ? (count ? '还有 ' + count + ' 件活儿…要不找千问和豆包？' : '吃白米饭，鲸鲸！今天想玩什么游戏？')
      : (count ? '还有 ' + count + ' 件小事，我们一件一件来。' : '很高兴见到你。想聊一聊，还是一起专注？'),
    syncMood(mood) { baseMood = mood; if (action === 'idle') resetPose(); },
    respond
  };
};
