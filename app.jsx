/* ============================================================
   APP — wires graph, search, panel, Q&A, theme switcher, vault loader
   ============================================================ */

const { useState, useEffect, useRef, useMemo } = React;

const DEFAULT_THEME = 'atlas';

function App() {
  const [vault, setVault] = useState(() => window.VAULT);
  const [themeId, setThemeId] = useState(DEFAULT_THEME);
  const theme = window.THEMES[themeId];

  const [groupBy, setGroupBy] = useState('folder'); // 'folder' | 'top-tag' | 'frontmatter:<field>'
  const [searchMode, setSearchMode] = useState('notes'); // 'notes' | 'concepts'

  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [query, setQuery] = useState('');
  const [themeFilter, setThemeFilter] = useState(() => new Set());
  const [tagFilter, setTagFilter] = useState(() => new Set());
  const [lassoMode, setLassoMode] = useState(false);
  const [lassoSelection, setLassoSelection] = useState(new Set());
  const [qaMessages, setQaMessages] = useState([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaTab, setQaTab] = useState('note');
  const [boot, setBoot] = useState(true);
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(380);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aiStatus, setAiStatus] = useState(() => window.aiStatus());
  const graphRef = useRef(null);

  // boot fade-out
  useEffect(() => {
    const t = setTimeout(() => setBoot(false), 1100);
    return () => clearTimeout(t);
  }, []);

  // theme → body data attribute (drives CSS) — single source of truth
  useEffect(() => {
    document.body.setAttribute('data-theme', themeId);
  }, [themeId]);

  // recompute clusters whenever groupBy changes (or vault swaps)
  useEffect(() => {
    if (!window.recomputeClusters) return;
    window.recomputeClusters(vault, groupBy);
    // bump a counter to trigger a re-render in children that read vault.themes
    setVault(v => ({ ...v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, vault.notes]);

  // ---- derived: search results
  const results = useMemo(() => {
    let arr = vault.notes;
    if (themeFilter.size) arr = arr.filter(n => themeFilter.has(n.theme));
    if (tagFilter.size) arr = arr.filter(n => n.tags.some(t => tagFilter.has(t)));
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(n =>
        (n.displayTitle || n.title).toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        n.tags.some(t => t.includes(q)) ||
        n.body.toLowerCase().includes(q)
      );
      arr = arr.slice().sort((a, b) => {
        const at = (a.displayTitle || a.title).toLowerCase().indexOf(q);
        const bt = (b.displayTitle || b.title).toLowerCase().indexOf(q);
        const aRank = at >= 0 ? at : 10000 + (a.tags.some(t=>t.includes(q)) ? 100 : 1000);
        const bRank = bt >= 0 ? bt : 10000 + (b.tags.some(t=>t.includes(q)) ? 100 : 1000);
        return aRank - bRank;
      });
    } else {
      arr = arr.slice().sort((a, b) => {
        if (a.isHub !== b.isHub) return a.isHub ? -1 : 1;
        if (a.themeIdx !== b.themeIdx) return a.themeIdx - b.themeIdx;
        return (a.displayTitle || a.title).localeCompare(b.displayTitle || b.title);
      });
    }
    return arr;
  }, [query, themeFilter, tagFilter, vault]);

  const focusedIds = useMemo(() => {
    if (lassoSelection.size > 0) return null;
    if (!selectedId) return null;
    const n = vault.byId[selectedId];
    if (!n) return null;
    return new Set([n.id, ...n.outLinks, ...n.inLinks]);
  }, [selectedId, lassoSelection, vault]);

  const activeFilters = useMemo(() => ({
    themes: themeFilter,
    tags: tagFilter,
    search: query.length >= 2 ? query : '',
  }), [themeFilter, tagFilter, query]);

  // ---- handlers ----
  function selectNote(id, opts) {
    setSelectedId(id);
    if (id && opts?.fly && graphRef.current) graphRef.current.flyTo(id, 1.7);
    if (id) setQaTab('note');
  }
  function toggleTheme(themeKey) {
    setThemeFilter(prev => {
      const s = new Set(prev);
      if (s.has(themeKey)) s.delete(themeKey); else s.add(themeKey);
      return s;
    });
  }
  function toggleTag(tag) {
    setTagFilter(prev => {
      const s = new Set(prev);
      if (s.has(tag)) s.delete(tag); else s.add(tag);
      return s;
    });
  }
  function clearFilters() {
    setThemeFilter(new Set());
    setTagFilter(new Set());
    setQuery('');
  }
  function onLassoComplete(ids) {
    if (!ids || ids.length === 0) { setLassoSelection(new Set()); return; }
    const s = new Set(ids);
    setLassoSelection(s);
    setLassoMode(false);
    setQaTab('qa');
    autoSummarize(s);
  }
  function clearLasso() {
    setLassoSelection(new Set());
    setQaMessages([]);
  }

  const qaScope = useMemo(() => {
    if (lassoSelection.size > 0) return lassoSelection;
    if (selectedId) return new Set([selectedId]);
    return new Set();
  }, [lassoSelection, selectedId]);

  useEffect(() => { setQaMessages([]); }, [selectedId, lassoSelection]);

  function buildContext(ids, maxNotes = 18, maxChars = 6000) {
    const noteList = [...ids].map(id => vault.byId[id]).filter(Boolean);
    noteList.sort((a, b) => {
      if (a.isHub !== b.isHub) return a.isHub ? -1 : 1;
      return (b.outLinks.length + b.inLinks.length) - (a.outLinks.length + a.inLinks.length);
    });
    let total = '', used = 0;
    const included = [];
    for (const n of noteList) {
      if (used >= maxNotes) break;
      const stripped = window.stripWikilinks(n.body)
        .replace(/^#+\s+/gm, '')
        .replace(/^\s*$\n/gm, '\n');
      const block = `### ${n.title}  [${n.themeName}]  ${n.tags.map(t=>'#'+t).join(' ')}\n${stripped.trim()}\n`;
      if ((total + block).length > maxChars) break;
      total += block + '\n';
      used++; included.push(n);
    }
    return { context: total, included };
  }

  async function autoSummarize(ids) {
    if (!ids || ids.size === 0) return;
    setQaLoading(true);
    const { context, included } = buildContext(ids);
    const prompt =
`You are exploring a personal Obsidian vault. The user just lassoed a region of the semantic map containing ${ids.size} notes (${included.length} included below).

Give a tight 3-5 sentence synthesis: what's the through-line, where are the tensions, and which one or two notes are load-bearing for this cluster. Be specific. Reference notes by their exact title. No preamble.

NOTES:
${context}`;
    try {
      const out = await window.aiComplete(prompt);
      const cites = findCitedNoteIds(out, included);
      setQaMessages([{ role: 'ai', text: out.trim(), cites }]);
    } catch (e) {
      setQaMessages([{ role: 'ai', text: '(synthesis failed: ' + (e && e.message ? e.message : 'unknown') + ')' }]);
    } finally {
      setQaLoading(false);
    }
  }

  async function sendQA(question) {
    if (qaScope.size === 0) return;
    setQaMessages(prev => [...prev, { role: 'user', text: question }]);
    setQaLoading(true);
    const { context, included } = buildContext(qaScope);
    const sys =
`You answer questions about a personal Obsidian vault. Use ONLY the notes provided as context. If something isn't covered, say so plainly. Be concise (2-6 sentences) and concrete. Reference notes by their exact title. Don't preface with "Based on..." or similar filler.

NOTES IN SCOPE (${included.length}):
${context}`;
    try {
      const out = await window.aiComplete({ messages: [{ role: 'user', content: sys + '\n\n---\nUser question: ' + question }] });
      const cites = findCitedNoteIds(out, included);
      setQaMessages(prev => [...prev, { role: 'ai', text: out.trim(), cites }]);
    } catch (e) {
      setQaMessages(prev => [...prev, { role: 'ai', text: '(error: ' + (e && e.message ? e.message : 'unknown') + ')' }]);
    } finally {
      setQaLoading(false);
    }
  }

  function findCitedNoteIds(text, scope) {
    const found = new Set();
    for (const n of scope) if (text.indexOf(n.title) >= 0) found.add(n.id);
    return [...found];
  }

  function startResize(side, e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === 'left' ? leftWidth : rightWidth;
    function onMove(ev) {
      const min = Math.round(window.innerWidth * 0.05);
      const max = Math.round(window.innerWidth * 0.25);
      const dx = ev.clientX - startX;
      const w = Math.min(max, Math.max(min, startW + (side === 'left' ? dx : -dx)));
      side === 'left' ? setLeftWidth(w) : setRightWidth(w);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ---- vault swap ----
  function handleVaultLoaded(newVault) {
    setVault(newVault);
    window.__loadedVault = newVault; // diagnostic handle
    setSelectedId(null);
    setLassoSelection(new Set());
    setQuery('');
    setThemeFilter(new Set());
    setTagFilter(new Set());
    setQaMessages([]);
    setShowVaultModal(false);
  }
  function resetToMockVault() {
    setVault(window.VAULT);
    setSelectedId(null);
    setLassoSelection(new Set());
    setQuery('');
    setThemeFilter(new Set());
    setTagFilter(new Set());
    setQaMessages([]);
    setShowVaultModal(false);
  }

  // ---- keyboard ----
  useEffect(() => {
    function onKey(e) {
      const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        const inp = document.querySelector('.search-input');
        if (inp) inp.focus();
      } else if (e.key === 'Escape') {
        if (showVaultModal) { setShowVaultModal(false); return; }
        if (isInput) e.target.blur();
        else if (lassoSelection.size > 0) clearLasso();
        else setSelectedId(null);
      } else if ((e.key === 'l' || e.key === 'L') && !isInput) {
        setLassoMode(m => !m);
      } else if ((e.key === 'v' || e.key === 'V') && !isInput) {
        e.preventDefault();
        setShowVaultModal(s => !s);
      } else if (e.key === '0' && !isInput) {
        graphRef.current?.resetView();
      } else if (e.key === 't' && !isInput) {
        // cycle theme
        const order = window.THEME_ORDER;
        setThemeId(prev => order[(order.indexOf(prev) + 1) % order.length]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lassoSelection, showVaultModal]);

  return (
    <>
      {boot && <BootScreen />}
      <div className="app" style={{'--left-w': leftWidth+'px', '--right-w': rightWidth+'px', gridTemplateColumns: `${leftWidth}px 1fr ${rightWidth}px`}}>
        <div className="col-handle col-handle-left" onMouseDown={e => startResize('left', e)} />
        <div className="col-handle col-handle-right" onMouseDown={e => startResize('right', e)} />
        <div className="topbar">
          <div className="brand" onClick={resetToMockVault} style={{cursor:'pointer'}} title="reload mock vault">VAULT://map</div>
          <div className="meta">
            {vault.stats.noteCount} notes · {vault.stats.edgeCount} edges · {vault.stats.themeCount} clusters
            {vault.source === 'local' ? <span style={{marginLeft:8, color:'var(--green)'}}>● live</span> : null}
          </div>

          <div className="spacer" />

          <AIStatusPill status={aiStatus} onClick={() => setShowSettings(true)} />
        </div>

        <SearchPane
          vault={vault}
          theme={theme}
          query={query} onQuery={setQuery}
          results={results}
          onSelectNote={(id) => selectNote(id, { fly: true })}
          selectedId={selectedId}
          themeFilter={themeFilter} onToggleTheme={toggleTheme}
          tagFilter={tagFilter} onToggleTag={toggleTag}
          onClearFilters={clearFilters}
          searchMode={searchMode} setSearchMode={setSearchMode}
          groupBy={groupBy} setGroupBy={setGroupBy}
        />

        <div className="graph">
          <GraphCanvas
            ref={graphRef}
            vault={vault}
            theme={theme}
            selectedId={selectedId}
            onSelectNode={(id) => selectNote(id)}
            onHoverNode={setHoveredId}
            lassoMode={lassoMode}
            onLassoComplete={onLassoComplete}
            lassoSelection={lassoSelection}
            activeFilters={activeFilters}
            focusedIds={focusedIds}
          />
          <div className="graph-controls">
            <button onClick={() => graphRef.current?.zoomBy(1.4)} title="zoom in">+</button>
            <button onClick={() => graphRef.current?.zoomBy(1/1.4)} title="zoom out">−</button>
            <button onClick={() => graphRef.current?.resetView()} title="fit">⊙</button>
            <button onClick={() => graphRef.current?.reheat()} title="re-layout">↻</button>
            <button
              className={lassoMode ? 'active' : ''}
              onClick={() => setLassoMode(m => !m)}
              title="lasso mode (or hold shift)"
            >◌</button>
          </div>
          {lassoSelection.size > 0 && (
            <div className="lasso-info">
              <span>{lassoSelection.size} selected</span>
              <button onClick={() => { setQaTab('qa'); autoSummarize(lassoSelection); }}>resummarize</button>
              <span className="x" onClick={clearLasso} title="clear">×</span>
            </div>
          )}
        </div>

        <NotePanel
          vault={vault}
          theme={theme}
          selectedId={selectedId}
          onSelectNote={(id) => selectNote(id, { fly: true })}
          lassoSelection={lassoSelection}
          onClearLasso={clearLasso}
          qa={{ messages: qaMessages, scope: qaScope }}
          onSendQA={sendQA}
          qaLoading={qaLoading}
          qaTab={qaTab}
          setQaTab={setQaTab}
        />

        <div className="statusbar">
          <span className="pill">●</span>
          <span>{vault.source === 'local' ? 'VAULT LOADED' : 'MOCK READY'}</span>
          <span className="sep">|</span>
          <span>{vault.stats.noteCount} notes</span>
          <span className="sep">·</span>
          <span>{vault.stats.edgeCount} links</span>
          <span className="sep">·</span>
          <span>{vault.stats.hubCount} MOCs</span>
          {selectedId && vault.byId[selectedId] && (
            <>
              <span className="sep">|</span>
              <span style={{color:'var(--green)'}}>{vault.byId[selectedId].displayTitle || vault.byId[selectedId].title}</span>
            </>
          )}
          {lassoSelection.size > 0 && (
            <>
              <span className="sep">|</span>
              <span style={{color:'var(--amber)'}}>lasso: {lassoSelection.size}</span>
            </>
          )}
          <div className="right-info">
            <span><kbd className="kbd">/</kbd> search</span>
            <span><kbd className="kbd">V</kbd> vault</span>
            <span><kbd className="kbd">L</kbd> lasso</span>
            <span><kbd className="kbd">T</kbd> theme</span>
            <span><kbd className="kbd">0</kbd> fit</span>
          </div>
        </div>
      </div>

      {showVaultModal && (
        <VaultLoaderModal
          onClose={() => setShowVaultModal(false)}
          onVaultLoaded={handleVaultLoaded}
        />
      )}
      {showSettings && (
        <SettingsModal
          onClose={(saved) => {
            setShowSettings(false);
            if (saved) setAiStatus(window.aiStatus());
          }}
        />
      )}
    </>
  );
}

function ThemePicker({ themeId, onChange }) {
  const order = window.THEME_ORDER;
  return (
    <div className="theme-picker">
      <span className="tp-label">theme</span>
      {order.map(id => {
        const t = window.THEMES[id];
        return (
          <span
            key={id}
            className={`tp-btn ${id === themeId ? 'active' : ''}`}
            onClick={() => onChange(id)}
            title={t.subtitle}
          >
            <span className="tp-swatch" style={{ background: t.swatch }} />
            {t.name}
          </span>
        );
      })}
    </div>
  );
}

function AIStatusPill({ status, onClick }) {
  const dotClass = status.ready ? '' : (status.provider && status.provider.needsKey ? 'warn' : 'off');
  const isBuiltin = status.provider && status.provider.id === 'builtin';
  return (
    <span className="ai-pill" onClick={onClick} title="AI provider settings">
      <span className={`dot ${dotClass}`} />
      {isBuiltin ? 'AI' : ('AI: ' + status.label)}
    </span>
  );
}

function BootScreen() {
  const lines = [
    'VaultMap Semantic Explorer',
    '',
    'mounting vault.................. ok',
    'parsing notes................... ok',
    'building wikilink graph......... ok',
    'computing tag adjacency......... ok',
    'seeding force layout............ ok',
    'attaching renderer.............. ok',
    '',
    '> ready_',
  ];
  return (
    <div className="boot" id="boot">
      <pre>{lines.join('\n')}</pre>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
