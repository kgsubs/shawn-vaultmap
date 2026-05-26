/* ============================================================
   NOTE PANEL — right column
   Tabs: NOTE (markdown + neighbors + AI summary) and Q&A.
   Custom marked renderer transforms [[wikilinks]] into clickable
   spans that resolve back to vault note ids.
   ============================================================ */

const { useState, useEffect, useRef } = React;

function noteColor(note, theme) {
  if (theme && theme.clusters) return theme.clusters[note.themeIdx] || note.color;
  return note.color;
}

function configureMarked(vault) {
  if (!window.marked) return null;

  // pre-process [[wikilinks]] before marked parses
  function preprocessWikilinks(md) {
    return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
      const display = (alias || target).trim();
      const found = vault.findByTitle(target.trim());
      const id = found ? found.id : '';
      const broken = found ? '' : ' broken';
      // we'll use a custom href that the click handler intercepts
      return `<a class="wikilink${broken}" data-vaultid="${id}" data-vaulttarget="${escapeAttr(target)}">${escapeHtml(display)}</a>`;
    });
  }
  function escapeAttr(s){ return String(s).replace(/"/g,'&quot;'); }
  function escapeHtml(s){ return String(s).replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }

  return function render(md) {
    const pre = preprocessWikilinks(md);
    return window.marked.parse(pre, { breaks: true });
  };
}

function NotePanel({
  vault, theme, selectedId, onSelectNote, lassoSelection, onClearLasso,
  qa, onSendQA, qaLoading,
  qaTab, setQaTab,
}) {
  const renderRef = useRef(null);
  if (!renderRef.current) renderRef.current = configureMarked(vault);
  const note = selectedId ? vault.byId[selectedId] : null;
  const hasLasso = lassoSelection && lassoSelection.size > 0;

  // tabs: note vs q&a
  return (
    <div className="right">
      <div className="tabs">
        <div
          className={`tab ${qaTab === 'note' ? 'active' : ''}`}
          onClick={() => setQaTab('note')}
        >NOTE</div>
        <div
          className={`tab ${qaTab === 'qa' ? 'active' : ''}`}
          onClick={() => setQaTab('qa')}
        >Q&A {qa.messages.length > 0 && qa.scope ? <span className="badge">{qa.scope.size}</span> : ''}</div>
      </div>

      {qaTab === 'note' && (
        <NoteView
          vault={vault}
          theme={theme}
          note={note}
          render={renderRef.current}
          onSelectNote={onSelectNote}
          lassoSelection={lassoSelection}
          onClearLasso={onClearLasso}
        />
      )}
      {qaTab === 'qa' && (
        <QAPanel
          vault={vault}
          theme={theme}
          qa={qa}
          onSend={onSendQA}
          loading={qaLoading}
          onSelectNote={onSelectNote}
        />
      )}
    </div>
  );
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

// ----------- NoteView -----------
function NoteView({ vault, theme, note, render, onSelectNote, lassoSelection, onClearLasso }) {
  const [aiSummary, setAiSummary] = useState(null);
  const [aiState, setAiState] = useState('idle'); // idle | loading | done | error
  const bodyRef = useRef(null);

  // reset AI when note changes
  useEffect(() => { setAiSummary(null); setAiState('idle'); }, [note?.id]);

  // click handler for wikilinks
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    function onClick(e) {
      const a = e.target.closest('a.wikilink');
      if (!a) return;
      e.preventDefault();
      const id = a.dataset.vaultid;
      if (id) onSelectNote(id);
    }
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [onSelectNote, note?.id]);

  if (!note && !lassoSelection?.size) {
    const topConcepts = (vault.tags || []).slice(0, 22);
    return (
      <div className="note-scroll">
        <div className="note-empty">
          <h3>// no note selected</h3>
          click a node in the map, search by title, or shift-drag a region to summarize.
          <br/><br/>
          <div className="section-h">TOP CONCEPTS</div>
          {topConcepts.length === 0 && (
            <div style={{fontSize:11, color:'var(--fg-faint)', padding:'4px 0'}}>no tags in this vault.</div>
          )}
          {topConcepts.map(t => (
            <div key={t.name} style={{display:'flex', alignItems:'center', gap:8, padding:'3px 0', fontSize:11, color:'var(--fg-dim)'}}>
              <span style={{flex:1, color:'var(--cyan)'}}>#{t.name}</span>
              <span style={{color:'var(--fg-faint)'}}>{t.count}</span>
            </div>
          ))}
          <div className="section-h" style={{marginTop:14}}>CLUSTERS</div>
          {vault.themes.map((t, i) => (
            <div key={t.id} style={{display:'flex', alignItems:'center', gap:8, padding:'3px 0', fontSize:11, color:'var(--fg-dim)'}}>
              <span style={{display:'inline-block', width:8, height:8, background:(theme && theme.clusters) ? theme.clusters[i] : t.color}}/>
              <span style={{flex:1}}>{t.name}</span>
              <span style={{color:'var(--fg-faint)'}}>{t.count}</span>
            </div>
          ))}
          <div style={{marginTop:14, padding:'10px 0 0', borderTop:'1px dashed var(--line-2)', fontSize:11, color:'var(--fg-faint)'}}>
            {vault.stats.noteCount} notes · {vault.stats.edgeCount} links · {vault.stats.tagCount} tags · {vault.stats.hubCount} MOC hubs
          </div>
        </div>
      </div>
    );
  }

  // lasso-only view: no specific note selected, but lasso is active
  if (!note && lassoSelection?.size) {
    return (
      <div className="note-scroll">
        <div className="note-body">
          <div className="note-title">Selection · {lassoSelection.size} notes</div>
          <div className="note-path">lasso scope · summarize from Q&A tab</div>
          <div className="section-h">NOTES IN SELECTION</div>
          <div className="neighbor-list">
            {[...lassoSelection].slice(0, 50).map(id => {
              const n = vault.byId[id];
              if (!n) return null;
              return (
                <div className="neighbor" key={id} onClick={() => onSelectNote(id)}>
                  <span className="dot" style={{background: noteColor(n, theme)}} />
                  <span className="t">{n.displayTitle || n.title}</span>
                  <span className="k">{n.themeName.slice(0,4).toUpperCase()}</span>
                </div>
              );
            })}
            {lassoSelection.size > 50 && (
              <div style={{padding:'6px', color:'var(--fg-faint)', fontSize:11}}>+ {lassoSelection.size - 50} more</div>
            )}
          </div>
          <button onClick={onClearLasso} style={{marginTop:14, fontSize:10, letterSpacing:'0.14em', textTransform:'uppercase'}}>clear selection</button>
        </div>
      </div>
    );
  }

  // resolve neighbors
  const outNeighbors = note.outLinks.map(id => vault.byId[id]).filter(Boolean);
  const inNeighbors = note.inLinks.map(id => vault.byId[id]).filter(Boolean);
  // shared-tag neighbors (excluding direct links)
  const linkedIds = new Set([...note.outLinks, ...note.inLinks, note.id]);
  const tagNeighbors = [];
  if (note.tags.length) {
    const seen = new Set();
    for (const t of note.tags) {
      for (const m of vault.notes) {
        if (linkedIds.has(m.id) || seen.has(m.id)) continue;
        if (m.tags.includes(t)) { tagNeighbors.push(m); seen.add(m.id); }
        if (tagNeighbors.length >= 8) break;
      }
      if (tagNeighbors.length >= 8) break;
    }
  }

  async function summarize() {
    setAiState('loading');
    try {
      const ctx = `Note: ${note.displayTitle || note.title}\nTheme: ${note.themeName}\nTags: ${note.tags.map(t=>'#'+t).join(' ')}\n\n${stripWikilinks(note.body)}\n\nLinked notes (titles only):\n${outNeighbors.slice(0,8).map(n=>'- '+(n.displayTitle || n.title)).join('\n')}`;
      const prompt = `Summarize this Obsidian note in 2-3 short sentences. Be specific and concrete; mention the most important connection. Don't list the tags. Don't preface with "This note..."—just write the summary.\n\n---\n${ctx}`;
      const out = await window.aiComplete(prompt);
      setAiSummary(out.trim());
      setAiState('done');
    } catch (e) {
      setAiSummary('(summary failed: ' + (e && e.message ? e.message : 'unknown') + ')');
      setAiState('error');
    }
  }

  const html = render ? render(note.body) : '';

  return (
    <div className="note-scroll">
      <div className="note-body">
        <h1 className="note-title">{note.displayTitle || note.title}</h1>
        <div className="note-path">{note.path}{note.isHub ? '  ·  HUB' : ''}</div>
        <div className="note-tags">
          {note.tags.map(t => (
            <span key={t} className="note-tag">#{t}</span>
          ))}
        </div>

        <div className="ai-box">
          <div className="ai-head">
            {aiState === 'loading' ? <><span className="spin"/> SUMMARIZING…</> : 'AI · SUMMARY'}
          </div>
          <div className={`ai-body ${aiSummary ? '' : 'dim'}`}>
            {aiSummary || 'click "summarize" to get a 2–3 sentence gist of this note.'}
          </div>
          <div className="ai-actions">
            <button onClick={summarize} disabled={aiState === 'loading'}>
              {aiSummary ? 're-summarize' : 'summarize'}
            </button>
            {aiSummary && <button onClick={() => { setAiSummary(null); setAiState('idle'); }}>clear</button>}
          </div>
        </div>

        <div className="section-h">CONTENT</div>
        <div className="markdown" ref={bodyRef} dangerouslySetInnerHTML={{__html: html}} />

        {outNeighbors.length > 0 && (
          <>
            <div className="section-h">OUTGOING · {outNeighbors.length}</div>
            <div className="neighbor-list">
              {outNeighbors.map(n => (
                <div className="neighbor" key={n.id} onClick={() => onSelectNote(n.id)}>
                  <span className="dot" style={{background: noteColor(n, theme)}} />
                  <span className="t">{n.displayTitle || n.title}</span>
                  <span className="k out">→</span>
                </div>
              ))}
            </div>
          </>
        )}

        {inNeighbors.length > 0 && (
          <>
            <div className="section-h">BACKLINKS · {inNeighbors.length}</div>
            <div className="neighbor-list">
              {inNeighbors.map(n => (
                <div className="neighbor" key={n.id} onClick={() => onSelectNote(n.id)}>
                  <span className="dot" style={{background: noteColor(n, theme)}} />
                  <span className="t">{n.displayTitle || n.title}</span>
                  <span className="k in">←</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tagNeighbors.length > 0 && (
          <>
            <div className="section-h">SHARED TAGS · {tagNeighbors.length}</div>
            <div className="neighbor-list">
              {tagNeighbors.map(n => (
                <div className="neighbor" key={n.id} onClick={() => onSelectNote(n.id)}>
                  <span className="dot" style={{background: noteColor(n, theme)}} />
                  <span className="t">{n.displayTitle || n.title}</span>
                  <span className="k tag">#</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function stripWikilinks(md) {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => (a || t));
}

window.NotePanel = NotePanel;
window.stripWikilinks = stripWikilinks;
