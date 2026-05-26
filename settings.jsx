/* ============================================================
   SETTINGS MODAL — AI provider + model + key configuration
   Reads/writes via window.aiGetConfig() / window.aiSetConfig()
   ============================================================ */

const { useState: sUseState, useEffect: sUseEffect } = React;

function SettingsModal({ onClose }) {
  const [config, setConfig] = sUseState(() => {
    const c = window.aiGetConfig();
    // deep clone so editing is local until save
    return JSON.parse(JSON.stringify(c));
  });
  const [testState, setTestState] = sUseState({ status: 'idle', message: '' });
  const [revealKey, setRevealKey] = sUseState(false);

  function update(fn) {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
  }

  function selectProvider(id) {
    update(c => { c.providerId = id; });
    setTestState({ status: 'idle', message: '' });
  }
  function setModel(id, model) {
    update(c => { c.modelByProvider[id] = model; });
  }
  function setKey(id, key) {
    update(c => { c.keys[id] = key; });
  }
  function setCustom(field, val) {
    update(c => { c.custom[field] = val; });
  }

  function save() {
    window.aiSetConfig(config);
    onClose(true);
  }

  async function testConnection() {
    setTestState({ status: 'running', message: 'sending a test prompt…' });
    // commit config temporarily so aiComplete uses it
    const prior = window.aiGetConfig();
    window.aiSetConfig(config);
    try {
      const out = await window.aiComplete('Reply with exactly one word: "ok".');
      setTestState({ status: 'ok', message: 'response: ' + (out || '').slice(0, 80).trim() });
    } catch (e) {
      setTestState({ status: 'error', message: (e && e.message ? e.message : String(e)).slice(0, 400) });
    } finally {
      // restore prior — don't auto-commit on test
      window.aiSetConfig(prior);
    }
  }

  const provider = window.PROVIDERS[config.providerId];
  const order = window.PROVIDER_ORDER;

  return (
    <div className="modal-backdrop" onClick={() => onClose(false)}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings · AI Provider</h2>
          <span className="close" onClick={() => onClose(false)}>×</span>
        </div>
        <div className="modal-body">
          <p style={{marginBottom: 14}}>Your keys are never shared. They're only kept in this browser's <code>localStorage</code>. Click TEST to verify a key before saving. Delete any key and SAVE to remove from localStorage.</p>

          <div className="settings-grid">
            <div className="settings-list">
              {order.filter(id => id !== 'builtin').map(id => {
                const p = window.PROVIDERS[id];
                const active = id === config.providerId;
                const hasKey = (id === 'custom') ? !!(config.custom.baseUrl) : (!p.needsKey || !!(config.keys[id] || '').length);
                return (
                  <div
                    key={id}
                    className={`settings-prov ${active ? 'active' : ''} ${id === 'builtin' ? 'disabled' : ''}`}
                    onClick={() => id !== 'builtin' && selectProvider(id)}
                  >
                    <div className="sp-name">
                      {p.name}
                      {hasKey ? <span className="sp-dot ok" title="configured" /> : <span className="sp-dot" title="not configured" />}
                    </div>
                    <div className="sp-sub">{p.subtitle}</div>
                  </div>
                );
              })}
            </div>

            <div className="settings-detail">
              <div className="sd-h">{provider.name}</div>
              <div className="sd-sub">{provider.subtitle}</div>

              {config.providerId === 'custom' ? (
                <>
                  <label className="sd-label">Base URL</label>
                  <input
                    className="sd-input"
                    placeholder="https://your-endpoint.example.com/v1   (or http://localhost:11434/v1)"
                    value={config.custom.baseUrl}
                    onChange={e => setCustom('baseUrl', e.target.value)}
                    spellCheck={false}
                  />
                  <label className="sd-label">Model id</label>
                  <input
                    className="sd-input"
                    placeholder="deepseek-chat  ·  kimi-k2  ·  llama3.1  ·  …"
                    value={config.custom.model}
                    onChange={e => setCustom('model', e.target.value)}
                    spellCheck={false}
                  />
                  <label className="sd-label">API key <span className="sd-opt">(optional)</span></label>
                  <input
                    className="sd-input"
                    type={revealKey ? 'text' : 'password'}
                    placeholder="leave blank if your endpoint doesn't require one"
                    value={config.custom.key}
                    onChange={e => setCustom('key', e.target.value)}
                    spellCheck={false}
                  />
                  <div className="sd-note">
                    Endpoint must speak the OpenAI Chat Completions schema (<code>POST {`/chat/completions`}</code>). Ollama and most self-hosted gateways do.
                  </div>
                </>
              ) : (
                <>
                  {provider.models.length > 0 && (
                    <>
                      <label className="sd-label">Model</label>
                      <select
                        className="sd-input"
                        value={config.modelByProvider[config.providerId] || provider.models[0].id}
                        onChange={e => setModel(config.providerId, e.target.value)}
                      >
                        {provider.models.map(m => (
                          <option key={m.id} value={m.id}>{m.name} <span style={{opacity:0.6}}>·  {m.id}</span></option>
                        ))}
                      </select>
                    </>
                  )}

                  {provider.needsKey && (
                    <>
                      <label className="sd-label">
                        API key
                        {provider.docsUrl && (
                          <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="sd-link">get one →</a>
                        )}
                      </label>
                      <div className="sd-keyrow">
                        <input
                          className="sd-input"
                          type={revealKey ? 'text' : 'password'}
                          placeholder={provider.keyHint}
                          value={config.keys[config.providerId] || ''}
                          onChange={e => setKey(config.providerId, e.target.value)}
                          spellCheck={false}
                          autoComplete="off"
                        />
                        <button type="button" className="sd-eye" onClick={() => setRevealKey(r => !r)} title={revealKey ? 'hide' : 'show'}>
                          {revealKey ? '◉' : '○'}
                        </button>
                      </div>
                    </>
                  )}

                  {config.providerId === 'anthropic' && (
                    <div className="sd-note">
                      Note: this is the developer API (separate billing from Claude Max).
                    </div>
                  )}
                </>
              )}

              <div className="sd-actions">
                <button onClick={testConnection} disabled={testState.status === 'running'}>
                  {testState.status === 'running' ? 'testing…' : 'test connection'}
                </button>
                {testState.status !== 'idle' && (
                  <span className={`sd-test sd-test-${testState.status}`}>
                    {testState.status === 'ok' ? '✓ ' : (testState.status === 'error' ? '✗ ' : '· ')}
                    {testState.message}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button onClick={() => onClose(false)}>cancel</button>
          <button onClick={save} className="primary">save</button>
        </div>
      </div>
    </div>
  );
}

window.SettingsModal = SettingsModal;
