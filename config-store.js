const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  provider: 'custom', baseURL: '', model: '', thinking: 'off',
  ttsEngine: 'edge', edgeFallback: false, pythonPath: 'python',
  sovitsURL: 'http://127.0.0.1:9880', refAudioPath: '', refText: '',
  remember: true
});
const PERSONAS = ['jingjing', 'xiaoxiao'];
function checkPersona(value) {
  if (!PERSONAS.includes(value)) throw new Error('请选择鲸鲸或小小。');
  return value;
}
function endpoint(value, localOnly = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('服务地址格式不正确。'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (localOnly ? !local || url.protocol !== 'http:' : url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error(localOnly ? '本地语音服务只允许本机 HTTP 地址。' : '模型地址需要 HTTPS；本机服务可用 HTTP。');
  }
  return url.href.replace(/\/+$/, '');
}
function validate(input) {
  const output = { ...DEFAULTS };
  for (const name of Object.keys(DEFAULTS)) {
    if (!Object.hasOwn(input, name)) continue;
    if (typeof input[name] !== typeof DEFAULTS[name]) throw new Error('设置格式不正确。');
    output[name] = typeof input[name] === 'string' ? input[name].trim() : input[name];
    if (typeof output[name] === 'string' && (output[name].length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(output[name]))) throw new Error('设置内容过长或包含控制字符。');
  }
  if (!['custom', 'qwen', 'deepseek'].includes(output.provider) ||
      !['off', 'auto', 'on'].includes(output.thinking) || !['off', 'edge', 'sovits'].includes(output.ttsEngine)) throw new Error('不支持的设置选项。');
  if (output.baseURL) output.baseURL = endpoint(output.baseURL);
  output.sovitsURL = endpoint(output.sovitsURL, true);
  if (output.model.length > 160 || /[\r\n]/.test(output.model)) throw new Error('模型名格式不正确。');
  if (!output.pythonPath || /[\r\n]/.test(output.pythonPath)) throw new Error('请输入 Python 路径。');
  return output;
}
function atomicJSON(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(filename + '.tmp', filename);
}
function createConfigStore({ directory, safeStorage }) {
  const filename = path.join(directory, 'chat-config.json');
  let settings = { ...DEFAULTS }, encryptedKey = '', loadError = false;
  try {
    if (fs.existsSync(filename)) {
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      settings = validate(saved.settings || {});
      encryptedKey = typeof saved.encryptedKey === 'string' ? saved.encryptedKey : '';
    }
  } catch { loadError = true; }
  function getKey() {
    if (!encryptedKey) return '';
    try { return safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')); }
    catch { throw new Error('保存的密钥无法解密，请在设置中重新输入。'); }
  }
  function read() {
    return { ...settings, hasKey: !!encryptedKey, encryptionAvailable: safeStorage.isEncryptionAvailable(), loadError };
  }
  return {
    read,
    privateConfig: () => ({ ...settings, apiKey: getKey() }),
    save(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式不正确。');
      const next = validate({ ...settings, ...input });
      let nextKey = encryptedKey;
      if (next.baseURL !== settings.baseURL) nextKey = ''; // Never send an old credential to a new endpoint.
      if (input.clearKey === true) nextKey = '';
      if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('密钥格式不正确。');
      const key = input.apiKey?.trim();
      if (key) {
        if (key.length > 4096 || /\s/.test(key)) throw new Error('密钥格式不正确。');
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密暂不可用，密钥未保存。');
        nextKey = safeStorage.encryptString(key).toString('base64');
      }
      atomicJSON(filename, { version: 1, settings: next, encryptedKey: nextKey });
      settings = next; encryptedKey = nextKey; loadError = false;
      return read();
    }
  };
}
module.exports = { DEFAULTS, PERSONAS, checkPersona, endpoint, atomicJSON, createConfigStore };
