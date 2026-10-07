const { createConfigStore } = require('./config-store');
const { createChatService } = require('./chat-service');

function registerChatIPC({ ipcMain, safeStorage, directory, getWindow, canChat = () => true, serviceOptions = {} }) {
  let store, service;
  function ensure() {
    if (service) return;
    store = createConfigStore({ directory: directory(), safeStorage });
    service = createChatService({ configStore: store, directory: directory(), ...serviceOptions,
      onEvent(event) {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('chat:event', event);
      } });
  }
  const allowed = event => {
    const win = getWindow();
    return win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  };
  function handle(channel, fn) {
    ipcMain.handle(channel, async (event, input) => {
      if (!allowed(event)) return { ok: false, message: '此页面不能操作聊天。' };
      try { ensure(); return { ok: true, data: await fn(input) }; }
      catch (error) { return { ok: false, message: error.message || '操作未完成，请重试。' }; }
    });
  }
  handle('config:get', () => store.read());
  handle('config:save', input => { service.cancel(); return store.save(input); });
  handle('chat:memory', persona => service.memory(persona));
  handle('chat:clear-memory', persona => { service.clearMemory(persona); return true; });
  handle('chat:send', input => {
    const win = getWindow();
    if (!canChat() || !win.isVisible() || win.isMinimized()) throw new Error('请先唤回桌面伙伴。');
    return { id: service.start(input).id };
  });
  ipcMain.on('chat:cancel', event => { if (allowed(event)) service?.cancel(); });
  return { cancel: () => service?.cancel() };
}
module.exports = { registerChatIPC };
