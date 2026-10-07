const fs = require('node:fs');
const path = require('node:path');
const { checkPersona, atomicJSON } = require('./config-store');

function createMemoryStore(directory) {
  const versions = new Map();
  const file = persona => path.join(directory, `chat-memory-${checkPersona(persona)}.json`);
  function read(persona) {
    try {
      const data = JSON.parse(fs.readFileSync(file(persona), 'utf8'));
      const turns = (Array.isArray(data.turns) ? data.turns : []).filter(t =>
        typeof t.user === 'string' && typeof t.assistant === 'string' && t.user.length <= 2000 && t.assistant.length <= 2400).slice(-24);
      return { summary: typeof data.summary === 'string' ? data.summary.slice(0, 1600) : '', turns };
    } catch { return { summary: '', turns: [] }; }
  }
  function write(persona, data) {
    atomicJSON(file(persona), data);
    versions.set(persona, (versions.get(persona) || 0) + 1);
  }
  return {
    read,
    append(persona, user, assistant) {
      const memory = read(persona);
      memory.turns.push({ user, assistant });
      memory.turns = memory.turns.slice(-24);
      write(persona, memory);
      return { memory, version: versions.get(persona) };
    },
    summarize(persona, summary, version, removed) {
      if (versions.get(persona) !== version) return false;
      const memory = read(persona);
      write(persona, { summary: summary.slice(0, 1600), turns: memory.turns.slice(removed) });
      return true;
    },
    clear(persona) { write(checkPersona(persona), { summary: '', turns: [] }); }
  };
}
module.exports = { createMemoryStore };
