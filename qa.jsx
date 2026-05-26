/* ============================================================
   Q&A PANEL — chat over selected note / lasso selection
   Scope shown in the header; bodies stuffed as context to Claude.
   ============================================================ */

const { useState, useEffect, useRef } = React;

function QAPanel({ vault, theme, qa, onSend, loading, onSelectNote }) {
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [qa.messages.length, loading]);

  const scopeIds = qa.scope; // Set
  const scopeNotes = scopeIds ? [...scopeIds].map(id => vault.byId[id]).filter(Boolean) : [];

  function send() {
    const q = input.trim();
    if (!q || loading) return;
    onSend(q);
    setInput('');
  }
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="qa-pane" style={{display:'flex', flexDirection:'column', flex:1, minHeight:0}}>
      <div className="qa-context">
        SCOPE: <span className="scope">
          {scopeNotes.length === 0
            ? 'nothing selected'
            : scopeNotes.length === 1
              ? scopeNotes[0].title
              : `${scopeNotes.length} notes`}
        </span>
        {scopeNotes.length > 1 && (
          <span style={{marginLeft:8, color:'var(--fg-faint)'}}>
            ({[...new Set(scopeNotes.map(n => n.themeName))].slice(0,3).join(', ')}{new Set(scopeNotes.map(n => n.themeName)).size > 3 ? '…' : ''})
          </span>
        )}
      </div>

      <div className="qa-log" ref={logRef}>
        {qa.messages.length === 0 && (
          <div className="qa-empty">
            ask anything about the {scopeNotes.length === 1 ? 'selected note' : scopeNotes.length > 0 ? 'selected notes' : 'vault'}.<br/>
            try:
            <ul style={{marginTop:6, paddingLeft:18}}>
              <li>"what's the through-line here?"</li>
              <li>"which of these notes is the weakest link?"</li>
              <li>"suggest 3 missing connections."</li>
              <li>"if i had to read just one of these, which?"</li>
            </ul>
          </div>
        )}
        {qa.messages.map((m, i) => (
          <div key={i} className={`qa-msg ${m.role}`}>
            <div className="who">{m.role === 'user' ? 'you' : 'claude'}</div>
            <div className="body">{m.text}</div>
            {m.cites && m.cites.length > 0 && (
              <div className="cites">
                {m.cites.map(id => {
                  const n = vault.byId[id];
                  if (!n) return null;
                  const col = (theme && theme.clusters) ? theme.clusters[n.themeIdx] : n.color;
                  return (
                    <span className="qa-cite" key={id} onClick={() => onSelectNote(id)} style={{borderLeft: `3px solid ${col}`}}>
                      {n.title}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="qa-msg ai">
            <div className="who">claude</div>
            <div className="body" style={{color:'var(--fg-dim)'}}>thinking<span className="spin" style={{display:'inline-block', width:6, height:6, background:'var(--amber)', marginLeft:6, verticalAlign:'middle', animation:'spin 0.8s steps(2,start) infinite'}}/></div>
          </div>
        )}
      </div>

      <div className="qa-input-wrap">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={scopeNotes.length === 0 ? 'select a note first…' : 'ask a question…'}
          disabled={scopeNotes.length === 0 || loading}
        />
        <button onClick={send} disabled={!input.trim() || loading || scopeNotes.length === 0}>
          send
        </button>
      </div>
    </div>
  );
}

window.QAPanel = QAPanel;
