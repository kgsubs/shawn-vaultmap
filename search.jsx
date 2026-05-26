/* ============================================================
   LEFT PANE — Group By selector, Notes/Concepts tabs, search,
   filters, results list.
   ============================================================ */

function noteColor(note, theme) {
  if (theme && theme.clusters) return theme.clusters[note.themeIdx] || note.color;
  return note.color;
}

function SearchPane({
  vault, theme,
  query, onQuery, results, onSelectNote, selectedId,
  themeFilter, onToggleTheme,
  tagFilter, onToggleTag,
  onClearFilters,
  searchMode, setSearchMode,
  groupBy, setGroupBy,
}) {
  return (
    <div className="left">
      <div className="search-pane">

        <GroupByBar
          vault={vault}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
        />

        <ModeTabs mode={searchMode} setMode={setSearchMode} />

        {searchMode === 'notes' ? (
          <NotesMode
            vault={vault} theme={theme}
            query={query} onQuery={onQuery}
            results={results}
            selectedId={selectedId} onSelectNote={onSelectNote}
            themeFilter={themeFilter} onToggleTheme={onToggleTheme}
            tagFilter={tagFilter} onToggleTag={onToggleTag}
            onClearFilters={onClearFilters}
          />
        ) : (
          <ConceptsMode
            vault={vault} theme={theme}
            tagFilter={tagFilter} onToggleTag={onToggleTag}
            themeFilter={themeFilter} onToggleTheme={onToggleTheme}
            onClearFilters={onClearFilters}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Group By selector (compact dropdown at very top of left pane)
// ============================================================
function GroupByBar({ vault, groupBy, setGroupBy }) {
  const opts = [
    { id: 'folder',  label: 'Folder' },
    { id: 'top-tag', label: 'Top concept (tag)' },
    { id: 'flat',    label: 'No grouping (let links drive)' },
  ];
  // surface frontmatter fields the vault actually uses
  const fmFields = (vault.groupableFmFields || []);
  for (const f of fmFields) opts.push({ id: 'frontmatter:' + f, label: 'Frontmatter: ' + f });

  return (
    <div className="groupby-bar">
      <label>cluster by</label>
      <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
        {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ============================================================
// Mode tabs (Notes | Concepts)
// ============================================================
function ModeTabs({ mode, setMode }) {
  return (
    <div className="mode-tabs">
      <div className={`mode-tab ${mode === 'notes' ? 'active' : ''}`} onClick={() => setMode('notes')}>Notes</div>
      <div className={`mode-tab ${mode === 'concepts' ? 'active' : ''}`} onClick={() => setMode('concepts')}>Concepts</div>
    </div>
  );
}

// ============================================================
// NOTES mode — search + result list (the old behavior)
// ============================================================
function NotesMode({
  vault, theme, query, onQuery, results, selectedId, onSelectNote,
  themeFilter, onToggleTheme, tagFilter, onToggleTag, onClearFilters,
}) {
  return (
    <>
      <div className="search-input-wrap">
        <span className="prompt">$</span>
        <input
          className="search-input"
          placeholder="grep titles, tags, body…"
          value={query}
          onChange={e => onQuery(e.target.value)}
          autoFocus
          spellCheck={false}
        />
        <span className="cursor-blink" aria-hidden="true" />
      </div>

      <ClusterChips vault={vault} themeFilter={themeFilter} onToggle={onToggleTheme} theme={theme} />

      {tagFilter.size > 0 && (
        <div className="filter-row" style={{borderTop: '1px solid var(--line)'}}>
          <span style={{fontSize:10, color:'var(--fg-faint)', marginRight:6, alignSelf:'center'}}>TAG</span>
          {[...tagFilter].map(t => (
            <span className="chip active" key={t} onClick={() => onToggleTag(t)}>#{t} ×</span>
          ))}
          <span className="chip" onClick={onClearFilters} style={{marginLeft:'auto'}}>clear all</span>
        </div>
      )}

      <ResultList
        results={results}
        query={query}
        selectedId={selectedId}
        onSelect={onSelectNote}
        vault={vault}
        theme={theme}
      />
    </>
  );
}

// ============================================================
// CONCEPTS mode — tag list ranked by frequency, click to filter
// ============================================================
function ConceptsMode({ vault, theme, tagFilter, onToggleTag, themeFilter, onToggleTheme, onClearFilters }) {
  const [conceptQuery, setConceptQuery] = React.useState('');
  const filtered = vault.tags.filter(t => !conceptQuery || t.name.includes(conceptQuery.toLowerCase()));
  const max = filtered[0]?.count || 1;

  return (
    <>
      <div className="search-input-wrap">
        <span className="prompt">#</span>
        <input
          className="search-input"
          placeholder="filter concepts…"
          value={conceptQuery}
          onChange={e => setConceptQuery(e.target.value)}
          spellCheck={false}
        />
        <span className="cursor-blink" aria-hidden="true" />
      </div>

      <ClusterChips vault={vault} themeFilter={themeFilter} onToggle={onToggleTheme} theme={theme} />

      {(tagFilter.size > 0 || themeFilter.size > 0) && (
        <div className="filter-row" style={{borderTop: '1px solid var(--line)'}}>
          {[...tagFilter].map(t => (
            <span className="chip active" key={t} onClick={() => onToggleTag(t)}>#{t} ×</span>
          ))}
          <span className="chip" onClick={onClearFilters} style={{marginLeft:'auto'}}>clear all</span>
        </div>
      )}

      <div className="results concepts-list">
        {filtered.length === 0 && (
          <div className="empty-state">no concepts match.</div>
        )}
        {filtered.slice(0, 400).map(t => {
          const active = tagFilter.has(t.name);
          const w = Math.max(0.05, t.count / max);
          return (
            <div
              key={t.name}
              className={`concept-row ${active ? 'active' : ''}`}
              onClick={() => onToggleTag(t.name)}
              title={`${t.count} notes`}
            >
              <span className="ct-name">#{t.name}</span>
              <span className="ct-bar"><span style={{width: (w * 100) + '%'}} /></span>
              <span className="ct-count">{t.count}</span>
            </div>
          );
        })}
        {filtered.length > 400 && (
          <div className="empty-state" style={{textAlign:'center'}}>… {filtered.length - 400} more (filter to narrow)</div>
        )}
      </div>
    </>
  );
}

// ============================================================
// Cluster chips — filter graph to one or more current clusters
// ============================================================
function ClusterChips({ vault, themeFilter, onToggle, theme }) {
  const shown = vault.themes.slice(0, 24); // cap the visible chip set
  return (
    <div className="filter-row">
      {shown.map((t, i) => {
        const active = themeFilter.has(t.id);
        const swatch = (theme && theme.clusters) ? theme.clusters[i] : t.color;
        return (
          <span
            key={t.id}
            className={`chip ${active ? 'active' : ''}`}
            onClick={() => onToggle(t.id)}
            title={`${t.count} notes`}
          >
            <span className="dot" style={{background: swatch}} />
            {t.name}
            <span style={{opacity:0.55, marginLeft:4, fontSize:10}}>{t.count}</span>
          </span>
        );
      })}
      {vault.themes.length > shown.length && (
        <span className="chip" style={{cursor:'default', color:'var(--fg-faint)'}}>+{vault.themes.length - shown.length} more</span>
      )}
    </div>
  );
}

function ResultList({ results, query, selectedId, onSelect, vault, theme }) {
  if (results.length === 0) {
    return (
      <div className="empty-state">
        no matches.<br/>
        try a different query, or clear filters.<br/><br/>
        <span style={{color:'var(--fg-dim)'}}>tips</span><br/>
        <span className="kbd">/</span> jump to search<br/>
        <span className="kbd">esc</span> clear selection<br/>
        <span className="kbd">shift+drag</span> lasso a region
      </div>
    );
  }

  return (
    <div className="results">
      {results.slice(0, 200).map(r => (
        <ResultRow
          key={r.id}
          note={r}
          query={query}
          active={r.id === selectedId}
          onClick={() => onSelect(r.id)}
          theme={theme}
        />
      ))}
      {results.length > 200 && (
        <div className="empty-state" style={{textAlign:'center'}}>
          … {results.length - 200} more (narrow your query)
        </div>
      )}
    </div>
  );
}

function ResultRow({ note, query, active, onClick, theme }) {
  const linkCount = note.outLinks.length + note.inLinks.length;
  const title = highlight(note.displayTitle || note.title, query);
  return (
    <div className={`result ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="dot" style={{background: noteColor(note, theme)}} />
      <span className="title" dangerouslySetInnerHTML={{__html: title}} />
      <span className="links">{linkCount}↔</span>
    </div>
  );
}

function highlight(text, query) {
  if (!query || query.length < 1) return escapeHtmlS(text);
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return escapeHtmlS(text);
  return (
    escapeHtmlS(text.slice(0, idx)) +
    '<em>' + escapeHtmlS(text.slice(idx, idx + q.length)) + '</em>' +
    escapeHtmlS(text.slice(idx + q.length))
  );
}

function escapeHtmlS(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

window.SearchPane = SearchPane;
