// 截图测试：stub 掉 window.widget，让页面在离屏窗口里跑起来
const { contextBridge } = require('electron');

// 根据 URL query 预置数据（preload 在页面脚本之前执行，localStorage 可用）
const q = new URLSearchParams(location.search);
const scenario = q.get('s') || 'collapsed';

const today = new Date();
const dayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

const base = {
  day: dayKey, totalDone: 12, lastDone: 4, history: {}, night: false,
  pomo: { count: 2, total: 30, day: dayKey, round: 2, mode: 'focus',
    running: false, endsAt: 0, remain: 25 * 60000, focusMin: 25, shortMin: 5, longMin: 15 }
};

const seeds = {
  collapsed: { todo: ['写周报 ✍', '给妈妈打电话', '读书 30 分钟'], done: ['晨跑 3 公里'] },
  expanded:  { todo: ['写周报 ✍', '给妈妈打电话', '读书 30 分钟', '整理桌面'], done: ['晨跑 3 公里', '浇水'] },
  focus:     { todo: ['写周报 ✍', '给妈妈打电话'], done: [],
    pomo: { mode: 'focus', running: true, endsAt: Date.now() + 12 * 60000, remain: 12 * 60000 } },
  sleep:     { todo: ['写周报 ✍'], done: [],
    pomo: { mode: 'short', running: true, endsAt: Date.now() + 4 * 60000, remain: 4 * 60000 } },
  star:      { todo: [], done: ['晨跑 3 公里', '写周报', '读书 30 分钟'] },
  night:     { todo: ['写周报 ✍', '读书 30 分钟'], done: ['晨跑 3 公里'], night: true },
};

const d = { ...base, ...(seeds[scenario] || {}) };
d.pomo = { ...base.pomo, ...(d.pomo || {}) };
d.day = dayKey; d.pomo.day = dayKey;
if (scenario !== 'persist') localStorage.setItem('todo-widget-v2', JSON.stringify(d));
let voicePending = null, voiceCalls = 0, voiceCancels = 0;
const voiceListeners = [], suspendListeners = [];
contextBridge.exposeInMainWorld('interactionTest', {
  finishVoice(result) { const finish = voicePending; voicePending = null; finish?.(result); },
  stats: () => ({ voiceCalls, voiceCancels, pending: !!voicePending }),
  suspend: () => suspendListeners.forEach(callback => callback())
});

contextBridge.exposeInMainWorld('widget', {
  setLayout() {}, setMousePassthrough() {}, pin() {}, hide() {}, close() {}, nudge() {},
  startDrag() {}, moveDrag() {}, endDrag() {}, onDragging() {},
  getVoiceSupport: () => Promise.resolve({ supported: true }),
  listenVoice() {
    voiceCalls++;
    voiceListeners.forEach(callback => callback('listening'));
    return new Promise(resolve => { voicePending = resolve; });
  },
  cancelVoice() { voiceCancels++; const finish = voicePending; voicePending = null; finish?.({ status: 'cancelled' }); },
  onVoiceState: callback => { voiceListeners.push(callback); },
  onSuspend: callback => { suspendListeners.push(callback); },
  getAutostart: () => Promise.resolve(false),
  setAutostart: () => Promise.resolve(false),
  onGhost() {}
});
