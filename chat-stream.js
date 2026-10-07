// Incremental parsing is shared by the live request and deterministic fixtures.
async function* readSSE(body, signal) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [], dataSize = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 262144) throw new Error('模型流数据过大。');
      if (done) buffer += '\n\n';
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.startsWith('data:')) {
          dataSize += line.length;
          if (dataSize > 262144) throw new Error('模型流数据过大。');
          data.push(line.slice(5).trimStart());
        }
        else if (line === '' && data.length) {
          const payload = data.join('\n'); data = []; dataSize = 0;
          if (payload === '[DONE]') return;
          let parsed;
          try { parsed = JSON.parse(payload); } catch { throw new Error('模型返回了无法解析的流式数据。'); }
          yield parsed;
        }
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

class ReplyFilter {
  constructor(onText, onTag) { this.onText = onText; this.onTag = onTag; this.pending = ''; this.thinking = 0; }
  push(chunk, final = false) {
    this.pending += chunk;
    while (this.pending) {
      if (this.thinking) {
        const match = /<\/?think\s*>/i.exec(this.pending);
        if (!match) { this.pending = final ? '' : this.pending.slice(-16); return; }
        this.thinking += /^<\//.test(match[0]) ? -1 : 1;
        this.pending = this.pending.slice(match.index + match[0].length);
        continue;
      }
      const start = this.pending.search(/[<\[]/);
      if (start < 0) { this.emit(this.pending); this.pending = ''; return; }
      if (start > 0) { this.emit(this.pending.slice(0, start)); this.pending = this.pending.slice(start); }
      const close = this.pending[0] === '<' ? '>' : ']';
      const end = this.pending.indexOf(close);
      if (end < 0) {
        if (final) this.pending = ''; // A truncated control token is never spoken.
        else if (this.pending.length > 512) throw new Error('模型返回的控制标签过长。');
        return;
      }
      const token = this.pending.slice(0, end + 1);
      this.pending = this.pending.slice(end + 1);
      if (/^<think\s*>$/i.test(token)) { this.thinking = 1; continue; }
      const action = /^\[action:(pat|dance|sleep|wake|wave)\]$/.exec(token);
      const command = /^\[(focus:start|focus:pause|list:open)\]$/.exec(token);
      const todo = /^\[todo:add:([^\[\]\r\n]{1,160})\]$/.exec(token);
      if (action) this.onTag({ type: 'action', value: action[1] });
      else if (command) this.onTag({ type: 'command', value: command[1] });
      else if (todo?.[1].trim()) this.onTag({ type: 'todo', value: todo[1].trim() });
      else if (token[0] === '[' && !/^\[(action|todo|focus|list):/.test(token)) this.emit(token);
    }
  }
  emit(text) {
    const clean = text.replace(/[`*#_]/g, '').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '');
    if (clean) this.onText(clean);
  }
}
class SentenceBuffer {
  constructor(onSentence) { this.pending = ''; this.onSentence = onSentence; }
  push(text, final = false) {
    this.pending += text;
    while (this.pending) {
      let cut = this.pending.search(/[。！？!?；;\n]/);
      if (cut >= 0 && cut < 120) cut++;
      else if (this.pending.length >= 120) {
        cut = Math.max(this.pending.lastIndexOf('，', 119), this.pending.lastIndexOf(' ', 119));
        cut = cut >= 35 ? cut + 1 : 120;
      } else if (final) cut = this.pending.length;
      else return;
      const sentence = this.pending.slice(0, cut).trim();
      this.pending = this.pending.slice(cut);
      if (sentence && /[\p{L}\p{N}]/u.test(sentence)) this.onSentence(sentence);
    }
  }
}
module.exports = { readSSE, ReplyFilter, SentenceBuffer };
