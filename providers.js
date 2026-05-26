/* ============================================================
   AI PROVIDERS
   Plug-in adapters for different LLM APIs. All adapters take a
   normalized { messages, model, key, maxTokens, system } shape
   and return a string. window.aiComplete dispatches to the
   currently configured provider, with graceful fallback to the
   built-in artifact helper when running inside the preview.

   Config persistence: localStorage 'vault.aiConfig.v1'
   ============================================================ */

(function () {

const CONFIG_KEY = 'vault.aiConfig.v1';

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}
function saveConfig(c) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch (_) {}
}

function defaultConfig() {
  const hasBuiltin = !!(window.claude && window.claude.complete);
  return {
    providerId: hasBuiltin ? 'builtin' : 'deepseek',
    modelByProvider: {
      builtin: 'haiku',
      deepseek: 'deepseek-chat',
      kimi: 'kimi-k2-0905-preview',
      anthropic: 'claude-haiku-4-5',
      openai: 'gpt-4o-mini',
      openrouter: 'anthropic/claude-haiku-4-5',
      custom: '',
    },
    keys: { deepseek: '', kimi: '', anthropic: '', openai: '', openrouter: '' },
    custom: { baseUrl: '', model: '', key: '' }, // user-defined OpenAI-compatible
  };
}

// merge defaults so older saved configs get new fields
function mergeConfig(saved) {
  const d = defaultConfig();
  if (!saved) return d;
  return {
    providerId: saved.providerId || d.providerId,
    modelByProvider: { ...d.modelByProvider, ...(saved.modelByProvider || {}) },
    keys: { ...d.keys, ...(saved.keys || {}) },
    custom: { ...d.custom, ...(saved.custom || {}) },
  };
}

let CONFIG = mergeConfig(loadConfig());

window.aiGetConfig = () => CONFIG;
window.aiSetConfig = (next) => {
  CONFIG = mergeConfig(next);
  saveConfig(CONFIG);
  return CONFIG;
};

// ============================================================
// Provider registry
// ============================================================
const PROVIDERS = {
  builtin: {
    id: 'builtin',
    name: 'Built-in (preview only)',
    subtitle: 'Claude Haiku 4.5 via this preview host. Will not work when the HTML is opened directly from disk.',
    needsKey: false,
    keyHint: '',
    docsUrl: '',
    models: [{ id: 'haiku', name: 'Haiku 4.5' }],
    available: () => !!(window.claude && window.claude.complete),
    complete: async ({ messages }) => {
      if (!window.claude || !window.claude.complete) throw new Error('Built-in helper not available. Pick a different provider in Settings.');
      // window.claude.complete accepts either a string or { messages }
      if (messages.length === 1 && messages[0].role === 'user') {
        return await window.claude.complete(messages[0].content);
      }
      return await window.claude.complete({ messages });
    },
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    subtitle: 'OpenAI-compatible. Cheap; good for summaries.',
    needsKey: true,
    keyHint: 'sk-…',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-chat',     name: 'DeepSeek Chat (V3)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
    ],
    available: () => true,
    complete: async ({ messages, model, key, maxTokens = 1024 }) => {
      return await openaiCompatChat({
        url: 'https://api.deepseek.com/chat/completions',
        key, model: model || 'deepseek-chat', messages, maxTokens,
      });
    },
  },

  kimi: {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    subtitle: 'OpenAI-compatible. Big context windows.',
    needsKey: true,
    keyHint: 'sk-…',
    docsUrl: 'https://platform.moonshot.ai/console/api-keys',
    models: [
      { id: 'kimi-k2-0905-preview', name: 'Kimi K2 (preview)' },
      { id: 'moonshot-v1-8k',       name: 'Moonshot v1 · 8k' },
      { id: 'moonshot-v1-32k',      name: 'Moonshot v1 · 32k' },
      { id: 'moonshot-v1-128k',     name: 'Moonshot v1 · 128k' },
    ],
    available: () => true,
    complete: async ({ messages, model, key, maxTokens = 1024 }) => {
      return await openaiCompatChat({
        url: 'https://api.moonshot.ai/v1/chat/completions',
        key, model: model || 'moonshot-v1-32k', messages, maxTokens,
      });
    },
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    subtitle: 'Direct calls to api.anthropic.com (separate billing from Claude Max).',
    needsKey: true,
    keyHint: 'sk-ant-…',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-haiku-4-5',  name: 'Haiku 4.5' },
      { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
    ],
    available: () => true,
    complete: async ({ messages, model, key, maxTokens = 1024 }) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: model || 'claude-haiku-4-5',
          max_tokens: maxTokens,
          messages,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error('Anthropic ' + res.status + ': ' + text.slice(0, 240));
      }
      const data = await res.json();
      return (data.content || []).map(p => p.text || '').join('');
    },
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    subtitle: 'Direct calls to api.openai.com.',
    needsKey: true,
    keyHint: 'sk-…',
    docsUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
      { id: 'gpt-4o',      name: 'GPT-4o' },
      { id: 'gpt-4.1-mini',name: 'GPT-4.1 mini' },
    ],
    available: () => true,
    complete: async ({ messages, model, key, maxTokens = 1024 }) => {
      return await openaiCompatChat({
        url: 'https://api.openai.com/v1/chat/completions',
        key, model: model || 'gpt-4o-mini', messages, maxTokens,
      });
    },
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    subtitle: 'One key, all the models. Use slash-form ids: anthropic/claude-haiku-4-5, deepseek/deepseek-chat, etc.',
    needsKey: true,
    keyHint: 'sk-or-…',
    docsUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'anthropic/claude-haiku-4-5',  name: 'Claude Haiku 4.5' },
      { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
      { id: 'deepseek/deepseek-chat',      name: 'DeepSeek Chat' },
      { id: 'moonshotai/kimi-k2',          name: 'Kimi K2' },
    ],
    available: () => true,
    complete: async ({ messages, model, key, maxTokens = 1024 }) => {
      return await openaiCompatChat({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key, model: model || 'anthropic/claude-haiku-4-5', messages, maxTokens,
        extraHeaders: {
          'HTTP-Referer': window.location.origin || 'http://localhost',
          'X-Title': 'VaultMap Semantic Explorer',
        },
      });
    },
  },

  custom: {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    subtitle: 'Bring your own. Set a base URL + model id + key. Used for self-hosted proxies, Ollama (e.g. http://localhost:11434/v1), or any OpenAI-compatible endpoint.',
    needsKey: false, // key is in .custom.key
    keyHint: '',
    docsUrl: '',
    models: [],
    available: () => true,
    complete: async ({ messages, maxTokens = 1024 }) => {
      const c = CONFIG.custom || {};
      if (!c.baseUrl) throw new Error('Custom provider: set a base URL in Settings.');
      const url = c.baseUrl.replace(/\/+$/, '') + '/chat/completions';
      return await openaiCompatChat({
        url,
        key: c.key || '',
        model: c.model || 'default',
        messages,
        maxTokens,
      });
    },
  },
};

window.PROVIDERS = PROVIDERS;
window.PROVIDER_ORDER = ['builtin','deepseek','kimi','anthropic','openai','openrouter','custom'];

// ============================================================
// OpenAI-compatible chat helper
// ============================================================
async function openaiCompatChat({ url, key, model, messages, maxTokens, extraHeaders }) {
  const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
  if (key) headers['Authorization'] = 'Bearer ' + key;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(model + ' ' + res.status + ': ' + text.slice(0, 240));
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ============================================================
// Public dispatcher
// ============================================================
window.aiComplete = async function aiComplete(input) {
  // input can be: a string OR { prompt: '...' } OR { messages: [...] }
  let messages;
  if (typeof input === 'string') {
    messages = [{ role: 'user', content: input }];
  } else if (input && Array.isArray(input.messages)) {
    messages = input.messages;
  } else if (input && typeof input.prompt === 'string') {
    messages = [{ role: 'user', content: input.prompt }];
  } else {
    throw new Error('aiComplete: bad input');
  }

  const providerId = CONFIG.providerId;
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error('Unknown provider: ' + providerId);

  const model = CONFIG.modelByProvider[providerId] || (provider.models[0] && provider.models[0].id) || '';
  const key = providerId === 'custom' ? '' : (CONFIG.keys[providerId] || '');

  if (provider.needsKey && !key) {
    throw new Error(provider.name + ': no API key set. Click Settings to add one.');
  }

  return await provider.complete({ messages, model, key, maxTokens: 1024 });
};

window.aiStatus = function aiStatus() {
  const pid = CONFIG.providerId;
  const provider = PROVIDERS[pid];
  if (!provider) return { ready: false, label: 'no provider' };
  if (pid === 'builtin') {
    const ok = !!(window.claude && window.claude.complete);
    return { ready: ok, label: ok ? 'Built-in' : 'Built-in (unavailable)', provider, model: 'haiku' };
  }
  if (pid === 'custom') {
    const c = CONFIG.custom || {};
    const ok = !!c.baseUrl;
    return { ready: ok, label: ok ? 'Custom: ' + (c.model || 'default') : 'Custom (no URL)', provider, model: c.model };
  }
  const key = CONFIG.keys[pid] || '';
  const model = CONFIG.modelByProvider[pid] || (provider.models[0] && provider.models[0].id);
  if (provider.needsKey && !key) return { ready: false, label: provider.name + ' (no key)', provider, model };
  return { ready: true, label: provider.name + ' · ' + (model || ''), provider, model };
};

})();
