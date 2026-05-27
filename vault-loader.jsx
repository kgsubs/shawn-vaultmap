/* ============================================================
   VAULT LOADER — open a real Obsidian vault from disk
   Three input methods (in preference order):
     1. File System Access API (Chrome/Edge/Brave: showDirectoryPicker)
     2. Drag & drop a folder
     3. <input type="file" webkitdirectory> (fallback)

   Parses .md files for frontmatter tags, inline #tags, and
   [[wikilinks]], then builds a vault object in the same shape
   as window.VAULT (the mock).
   ============================================================ */

const { useState: vlUseState, useRef: vlUseRef, useEffect: vlUseEffect } = React;

function VaultLoaderModal({ onClose, onVaultLoaded }) {
  const [stage, setStage] = vlUseState('pick'); // pick | reading | parsing | done | error
  const [progress, setProgress] = vlUseState({ count: 0, total: 0, label: '' });
  const [error, setError] = vlUseState(null);
  const [dropping, setDropping] = vlUseState(false);
  const fileInputRef = vlUseRef(null);

  async function pickViaFSAccess() {
    if (!window.showDirectoryPicker) {
      setError('File System Access API not available — try drag-and-drop or browse instead.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      setStage('reading');
      const files = [];
      for await (const f of walkDirHandle(handle, '')) files.push(f);
      await processFiles(files, async f => {
        const file = await f.handle.getFile();
        return file.text();
      });
    } catch (e) {
      if (e.name === 'AbortError') { setStage('pick'); return; }
      setError(String(e && e.message ? e.message : e));
      setStage('error');
    }
  }

  async function* walkDirHandle(handle, path) {
    for await (const [name, h] of handle.entries()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const subPath = path ? path + '/' + name : name;
      if (h.kind === 'file') {
        if (name.toLowerCase().endsWith('.md')) yield { name, path: subPath, handle: h };
      } else if (h.kind === 'directory') {
        yield* walkDirHandle(h, subPath);
      }
    }
  }

  async function handleDrop(e) {
    e.preventDefault();
    setDropping(false);
    const items = [...(e.dataTransfer.items || [])];
    if (items.length === 0) return;

    setStage('reading');
    const files = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (!entry) continue;
      await walkEntry(entry, '', files);
    }
    await processFiles(files, async f => f.text);
  }

  function walkEntry(entry, path, out) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        if (!entry.name.toLowerCase().endsWith('.md')) return resolve();
        entry.file(async (file) => {
          const text = await file.text();
          out.push({ name: entry.name, path: path ? path + '/' + entry.name : entry.name, text });
          resolve();
        }, () => resolve());
      } else if (entry.isDirectory) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') return resolve();
        const reader = entry.createReader();
        const readBatch = () => {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) return resolve();
            for (const e of entries) {
              await walkEntry(e, path ? path + '/' + entry.name : entry.name, out);
            }
            readBatch();
          }, () => resolve());
        };
        readBatch();
      } else resolve();
    });
  }

  async function handleFilesInput(e) {
    const fileList = [...e.target.files];
    if (fileList.length === 0) return;
    setStage('reading');
    const files = fileList
      .filter(f => f.name.toLowerCase().endsWith('.md'))
      .map(f => ({ name: f.name, path: f.webkitRelativePath || f.name, text: null, blob: f }));
    await processFiles(files, async f => f.blob ? f.blob.text() : f.text);
  }

  async function processFiles(files, getText) {
    if (files.length === 0) {
      setError('No .md files found in that folder.');
      setStage('error');
      return;
    }
    setStage('parsing');
    setProgress({ count: 0, total: files.length, label: 'reading…' });

    const notes = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      let text = f.text;
      if (!text) text = await getText(f);
      f.text = text;
      const parsed = parseMarkdown(text, f.path);
      notes.push({
        rawName: f.name.replace(/\.md$/i, ''),
        path: f.path,
        text,
        ...parsed,
      });
      if (i % 25 === 0 || i === files.length - 1) {
        setProgress({ count: i + 1, total: files.length, label: f.path });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    setProgress({ count: files.length, total: files.length, label: 'building graph…' });
    await new Promise(r => setTimeout(r, 0));

    const vault = buildVaultFromNotes(notes);
    setStage('done');
    setProgress({ count: vault.notes.length, total: vault.notes.length, label: `${vault.notes.length} notes · ${vault.edges.length} links · ${vault.themes.length} clusters` });
    setTimeout(() => onVaultLoaded(vault), 350);
  }

  function chooseFiles() {
    if (fileInputRef.current) fileInputRef.current.click();
  }

  const hasFSA = !!window.showDirectoryPicker;
  // Cross-origin iframes can't actually invoke the picker even when the API exists.
  const inIframe = (function() { try { return window.self !== window.top; } catch (_) { return true; } })();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Open Vault</h2>
          <span className="close" onClick={onClose}>×</span>
        </div>
        <div className="modal-body">
          <p>Point this at any folder of <code>.md</code> files. Wikilinks, tags, and folder structure are parsed in your browser — nothing is uploaded anywhere.</p>

          {inIframe && (
            <div className="sd-note" style={{marginBottom: 12}}>
              You're viewing this inside an embedded preview, which blocks the OS folder picker. <strong>Use drag &amp; drop</strong> for now. When you run the HTML on your own machine, all three options work.
            </div>
          )}

          {stage === 'pick' && (
            <div className="options">
              <div
                className={`opt ${hasFSA && !inIframe ? '' : 'disabled'}`}
                onClick={() => hasFSA && !inIframe && pickViaFSAccess()}
                title={inIframe ? 'Blocked inside embedded previews — works when you run the HTML locally' : (hasFSA ? '' : 'Requires Chrome, Edge, Brave, or Arc')}
              >
                <span className="icon">⌘</span>
                <div>
                  <div className="ttl">Pick folder
                    <span className="badge">{inIframe ? 'Local only' : (hasFSA ? 'Best' : 'Unavailable')}</span>
                  </div>
                  <div className="sub">Opens your OS folder picker. Read-only access. Chrome / Edge / Brave / Arc.</div>
                </div>
              </div>

              <div
                className={`opt ${dropping ? 'dropping' : ''}`}
                onDragOver={e => { e.preventDefault(); setDropping(true); }}
                onDragLeave={() => setDropping(false)}
                onDrop={handleDrop}
              >
                <span className="icon">▼</span>
                <div>
                  <div className="ttl">Drag &amp; drop a folder</div>
                  <div className="sub">{dropping ? 'release to open…' : 'works in every browser. drop your vault folder anywhere on this card.'}</div>
                </div>
              </div>

              <div className="opt" onClick={chooseFiles}>
                <span className="icon">⎘</span>
                <div>
                  <div className="ttl">Browse files</div>
                  <div className="sub">classic file picker. select a folder of .md files.</div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  webkitdirectory=""
                  directory=""
                  multiple
                  accept=".md,text/markdown"
                  style={{ display: 'none' }}
                  onChange={handleFilesInput}
                />
              </div>
            </div>
          )}

          {(stage === 'reading' || stage === 'parsing') && (
            <div className="progress">
              <div className="head">{stage === 'reading' ? 'scanning vault…' : 'parsing notes…'}</div>
              <div className="bar"><span style={{ width: (progress.total ? (progress.count / progress.total * 100) : 0) + '%' }} /></div>
              <div className="detail">{progress.count}/{progress.total || '?'} · {progress.label}</div>
            </div>
          )}

          {stage === 'done' && (
            <div className="progress">
              <div className="head">ready</div>
              <div className="bar"><span style={{ width: '100%' }} /></div>
              <div className="detail">{progress.label}</div>
            </div>
          )}

          {stage === 'error' && (
            <div className="progress error">
              <div className="head">error</div>
              <div className="detail">{error}</div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          {stage === 'error' && <button onClick={() => { setError(null); setStage('pick'); }}>retry</button>}
          <button onClick={onClose}>{stage === 'done' ? 'close' : 'cancel'}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// markdown parser
// ============================================================

// Frontmatter fields treated as relation arrays — each value becomes a wikilink edge.
// Values can be bare titles, [[wikilink]] form, or path/to/note.
const RELATION_FIELDS = [
  'related','relates-to','relates_to',
  'links','linked','linkto','link-to',
  'references','references-to','refs',
  'see-also','see_also','seealso',
  'up','parent','parents','index',
  'children','child',
  'connects','connections',
  'prev','previous','next',
];
// Anything matching a date field is excluded.
const SEMANTIC_FIELDS = [
  'venture','status','type','tier','client','category','area',
  'project','stage','priority','kind','topic','topics','domain','subject',
  'mentions','concept','concepts',
];
const SKIP_FIELDS = new Set([
  'date','created','updated','last_updated','last-updated','modified',
  'source','goal','trigger','due','start','end','published',
  'aliases','alias','id','uuid','url','permalink','slug','cover','image',
]);

function parseFrontmatter(fmText) {
  // Crude YAML-ish parser sufficient for flat scalar / list fields.
  // Not a YAML lib — handles the common shapes: `key: value`, list inline `[a, b]`, list block.
  const out = {};
  if (!fmText) return out;
  const lines = fmText.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1].toLowerCase();
    let val = m[2];
    if (val === '' || val === '|' || val === '>') {
      // block list or block scalar — collect indented lines
      const block = [];
      i++;
      while (i < lines.length && /^\s+/.test(lines[i])) {
        const bm = lines[i].match(/^\s*-\s*(.+)$/);
        if (bm) block.push(stripQuotes(bm[1].trim()));
        else block.push(stripQuotes(lines[i].trim()));
        i++;
      }
      out[key] = block;
      continue;
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val.slice(1, -1).split(',').map(x => stripQuotes(x.trim())).filter(Boolean);
    } else {
      out[key] = stripQuotes(val.trim());
    }
    i++;
  }
  return out;
}
function stripQuotes(s) {
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function semanticTagsFromFrontmatter(fm) {
  const tags = [];
  for (const [rawKey, val] of Object.entries(fm)) {
    const key = rawKey.toLowerCase();
    if (SKIP_FIELDS.has(key)) continue;
    if (!SEMANTIC_FIELDS.includes(key) && key !== 'tag' && key !== 'tags') continue;
    const values = Array.isArray(val) ? val : [val];
    for (const v of values) {
      if (!v || typeof v !== 'string') continue;
      // skip obvious dates / URLs
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
      if (/^https?:\/\//i.test(v)) continue;
      const slug = String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slug) continue;
      if (key === 'tag' || key === 'tags') tags.push(slug);
      else tags.push(`${key}/${slug}`);
    }
  }
  return tags;
}

function parseMarkdown(text, path) {
  let body = text;
  const tags = new Set();
  const links = [];
  let frontmatter = {};

  // frontmatter
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = text.slice(fm[0].length);
    frontmatter = parseFrontmatter(fm[1]);
    // pull tags from any usable frontmatter field
    for (const t of semanticTagsFromFrontmatter(frontmatter)) tags.add(t);
    // pull edges from relation fields (related: [[X]], up: [[Y]], etc)
    for (const [k, val] of Object.entries(frontmatter)) {
      if (!RELATION_FIELDS.includes(k.toLowerCase())) continue;
      const values = Array.isArray(val) ? val : [val];
      for (const v of values) {
        const target = extractWikilinkTarget(v);
        if (target) links.push(target);
      }
    }
  }

  // strip code blocks before scanning for inline tags
  const noCode = body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');

  // inline #tags
  noCode.replace(/(^|[^\w&])#([A-Za-z][A-Za-z0-9_/-]*)/g, (_, _b, t) => {
    if (/^[a-f0-9]{3,8}$/i.test(t)) return '';
    tags.add(t);
    return '';
  });

  // wikilinks — [[Target]], [[Target|alias]], [[Target#section]], [[folder/Target]]
  body.replace(/!?\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (full, target) => {
    if (full.startsWith('!')) return ''; // embed, not a link
    links.push(target.trim());
    return '';
  });

  return {
    body,
    frontmatter,
    tags: [...tags],
    rawLinks: links,
  };
}

// Accept any of: "[[X]]", "[[X|alias]]", "X", "path/to/X", "[[path/to/X]]"
// Returns the wikilink target (caller resolves it). Strips quotes/whitespace.
function extractWikilinkTarget(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  // strip surrounding quotes
  s = s.replace(/^["']|["']$/g, '').trim();
  if (!s) return null;
  // [[X]] or [[X|alias]] form
  const wl = s.match(/^\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
  if (wl) return wl[1].trim();
  // skip URLs and obvious dates
  if (/^https?:\/\//i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // skip status/category-like single tokens (likely a scalar value, not a link)
  // — but path-like or multi-word strings ARE candidates
  if (s.includes('/') || /\s/.test(s)) return s;
  return null;
}

// ============================================================
// build vault from parsed notes (mirrors vault.js shape)
// ============================================================
function buildVaultFromNotes(parsedNotes) {
  function slugify(s) {
    return s.toLowerCase()
      .replace(/[\u2018\u2019']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  // --- step 1: cluster the notes -------------------------------------------
  // Default: by top-level folder.
  // If any top-level folder holds more than ~15% of the vault, split it by
  // its 2nd-level subfolder (e.g. _thinking/chat-insights vs _thinking/).
  const byTop = {};
  for (const n of parsedNotes) {
    const parts = n.path.split('/').filter(Boolean);
    const top = parts.length > 1 ? parts[0] : '(root)';
    if (!byTop[top]) byTop[top] = [];
    byTop[top].push(n);
  }
  const total = parsedNotes.length;
  const oversizeThreshold = Math.max(50, total * 0.15);
  const clusterDefs = [];
  for (const [top, group] of Object.entries(byTop)) {
    if (group.length > oversizeThreshold) {
      const by2nd = {};
      for (const n of group) {
        const parts = n.path.split('/').filter(Boolean);
        const second = parts.length > 2 ? parts[1] : '(root)';
        if (!by2nd[second]) by2nd[second] = [];
        by2nd[second].push(n);
      }
      const sub = Object.entries(by2nd);
      const significant = sub.filter(([k, ns]) => ns.length >= 10).length;
      if (significant >= 2) {
        for (const [second, ns] of sub) {
          const name = second === '(root)' ? top : `${top} / ${second}`;
          clusterDefs.push({ name, key: top + '/' + second, folder: top + (second === '(root)' ? '' : '/' + second), notes: ns });
        }
      } else {
        clusterDefs.push({ name: top, key: top, folder: top, notes: group });
      }
    } else {
      clusterDefs.push({ name: top, key: top, folder: top, notes: group });
    }
  }
  clusterDefs.sort((a, b) => b.notes.length - a.notes.length || a.name.localeCompare(b.name));

  // build theme objects (color comes later from active theme palette)
  const seedColors = (window.THEMES && window.THEMES.atlas && window.THEMES.atlas.clusters) || [];
  const themes = clusterDefs.map((c, i) => ({
    id: slugify(c.key) || ('cluster-' + i),
    name: c.name,
    folder: c.folder,
    themeIdx: i,
    count: c.notes.length,
    tagPool: [],
    titles: [],
    color: seedColors[i % seedColors.length] || '#888',
  }));

  // map: cluster-key -> themeIdx
  const themeIdxByKey = {};
  clusterDefs.forEach((c, i) => { themeIdxByKey[c.key] = i; });
  // map: note.path -> themeIdx
  const pathToThemeIdx = {};
  clusterDefs.forEach((c, i) => { c.notes.forEach(n => { pathToThemeIdx[n.path] = i; }); });

  // --- step 2: build note objects -----------------------------------------
  const notes = [];
  const titleToId = {};
  const idCollisions = {};
  const byPathLower = {};
  const basenameMap = {};

  for (const pn of parsedNotes) {
    const parts = pn.path.split('/').filter(Boolean);
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '/';
    const title = pn.rawName;
    let id = slugify(title);
    if (titleToId[title.toLowerCase()] || idCollisions[id]) {
      id = id + '-' + Math.abs(hashStr(pn.path)).toString(36).slice(0, 4);
    }
    idCollisions[id] = true;

    const themeIdx = pathToThemeIdx[pn.path] ?? 0;
    const theme = themes[themeIdx];
    const note = {
      id,
      title,
      theme: theme.id,
      themeName: theme.name,
      themeIdx,
      color: theme.color,
      folder,
      path: pn.path,
      idxInTheme: 0,
      tags: pn.tags,
      body: pn.body,
      frontmatter: pn.frontmatter || {},
      outLinks: [],
      inLinks: [],
      wordCount: pn.body.split(/\s+/).length,
      isHub: false,
      _rawLinks: pn.rawLinks,
    };
    notes.push(note);
    if (!titleToId[title.toLowerCase()]) titleToId[title.toLowerCase()] = id;
    note.displayTitle = cleanDisplayTitle(title);
    byPathLower[pn.path.toLowerCase()] = note;
    const base = title.toLowerCase();
    if (!basenameMap[base]) basenameMap[base] = [];
    basenameMap[base].push(note);
  }

  const byId = Object.fromEntries(notes.map(n => [n.id, n]));

  // --- step 3: resolve wikilinks (path-aware, closest-match) --------------
  function folderDistance(a, b) {
    if (a.path === b.path) return 0;
    const pa = a.path.split('/').slice(0, -1);
    const pb = b.path.split('/').slice(0, -1);
    let common = 0;
    while (common < pa.length && common < pb.length && pa[common] === pb[common]) common++;
    return (pa.length - common) + (pb.length - common);
  }
  function pickClosest(candidates, source) {
    if (candidates.length === 1) return candidates[0];
    return [...candidates].sort((a, b) => folderDistance(source, a) - folderDistance(source, b))[0];
  }
  function resolveWikilink(targetRaw, source) {
    if (!targetRaw) return null;
    const target = targetRaw.trim();
    const tLower = target.toLowerCase();

    if (target.includes('/')) {
      // a. Relative to source folder
      const srcDir = source.path.split('/').slice(0, -1).join('/');
      const relPath = (srcDir ? srcDir + '/' : '') + target + '.md';
      if (byPathLower[relPath.toLowerCase()]) return byPathLower[relPath.toLowerCase()];

      // b. Absolute from vault root
      const absPath = target + '.md';
      if (byPathLower[absPath.toLowerCase()]) return byPathLower[absPath.toLowerCase()];

      // c. Path-suffix match anywhere
      const suffix = '/' + tLower + '.md';
      const matches = [];
      for (const [p, n] of Object.entries(byPathLower)) {
        if (p === absPath.toLowerCase() || p.endsWith(suffix)) matches.push(n);
      }
      if (matches.length) return pickClosest(matches, source);
    }

    // d. Basename match
    const base = target.split('/').pop().toLowerCase();
    const matches = basenameMap[base] || [];
    if (matches.length) return pickClosest(matches, source);

    return null;
  }

  notes.forEach(n => {
    const seen = new Set();
    for (const target of n._rawLinks) {
      const resolved = resolveWikilink(target, n);
      if (resolved && resolved.id !== n.id && !seen.has(resolved.id)) {
        n.outLinks.push(resolved.id);
        seen.add(resolved.id);
      }
    }
  });
  notes.forEach(n => {
    n.outLinks.forEach(tid => { if (byId[tid]) byId[tid].inLinks.push(n.id); });
  });

  // --- step 4: hub detection ----------------------------------------------
  // Hubs are: context.md files, any "MOC"/"Index"/"Home" title, and top-degree notes.
  for (const n of notes) {
    const base = (n.path.split('/').pop() || '').toLowerCase();
    if (base === 'context.md' || base === 'index.md' || base === 'home.md' || base === 'moc.md') {
      n.isHub = true;
    } else if (/^(MOC|Map of Content|Index|Home)\b/i.test(n.title)) {
      n.isHub = true;
    }
  }
  const byDegree = [...notes].sort((a, b) => (b.outLinks.length + b.inLinks.length) - (a.outLinks.length + a.inLinks.length));
  const hubCount = Math.max(1, Math.round(notes.length * 0.04));
  byDegree.slice(0, hubCount).forEach(n => { n.isHub = true; });

  // --- step 5: idxInTheme + edges + tag aggregation -----------------------
  themes.forEach(theme => {
    const inTheme = notes.filter(n => n.themeIdx === theme.themeIdx);
    inTheme.sort((a, b) => a.title.localeCompare(b.title));
    inTheme.forEach((n, i) => { n.idxInTheme = i; });
    theme.titles = inTheme.map(n => n.title);
  });

  const edges = [];
  notes.forEach(n => {
    n.outLinks.forEach(target => {
      if (byId[target]) edges.push({ source: n.id, target, kind: 'wikilink' });
    });
  });

  const tagMap = {};
  notes.forEach(n => {
    n.tags.forEach(t => {
      if (!tagMap[t]) tagMap[t] = { name: t, count: 0, themes: {} };
      tagMap[t].count++;
      tagMap[t].themes[n.theme] = (tagMap[t].themes[n.theme] || 0) + 1;
    });
  });
  const tags = Object.values(tagMap).sort((a, b) => b.count - a.count);

  // discover usable frontmatter group-by fields: scalar values, appearing on >=5 notes
  const fmFieldCounts = {};
  notes.forEach(n => {
    for (const [k, v] of Object.entries(n.frontmatter || {})) {
      if (SKIP_FIELDS.has(k)) continue;
      if (Array.isArray(v) || !v || typeof v !== 'string') continue;
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
      if (/^https?:\/\//i.test(v)) continue;
      fmFieldCounts[k] = (fmFieldCounts[k] || 0) + 1;
    }
  });
  const groupableFmFields = Object.entries(fmFieldCounts)
    .filter(([_, c]) => c >= 5)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  function findByTitle(t) {
    if (!t) return null;
    const id = titleToId[t.toLowerCase()];
    return id ? byId[id] : null;
  }

  notes.forEach(n => delete n._rawLinks);

  return {
    notes,
    edges,
    tags,
    themes,
    byId,
    titleToId,
    findByTitle,
    groupableFmFields,
    stats: {
      noteCount: notes.length,
      edgeCount: edges.length,
      tagCount: tags.length,
      themeCount: themes.length,
      hubCount: notes.filter(n => n.isHub).length,
    },
    source: 'local',
  };
}

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ============================================================
// recomputeClusters — change the clustering axis at runtime
// without re-parsing the vault. Mutates note.themeIdx/theme/
// themeName/color and returns a NEW themes array.
//
// strategy:
//   'folder'                  — top-level folder, oversize split
//   'top-tag'                 — each note's top (highest-count) tag
//   'frontmatter:<fieldname>' — e.g. 'frontmatter:venture'
//   'flat'                    — single cluster (force layout takes over)
// ============================================================
function recomputeClusters(vault, strategy) {
  function slugify(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u2018\u2019']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  const notes = vault.notes;
  const seedColors = (window.THEMES && window.THEMES.atlas && window.THEMES.atlas.clusters) || [];

  // For top-tag we need a global tag count to pick each note's "top" tag.
  const globalTagCount = {};
  if (strategy === 'top-tag') {
    for (const n of notes) for (const t of n.tags) globalTagCount[t] = (globalTagCount[t] || 0) + 1;
  }

  function bucketFor(note) {
    if (strategy === 'flat') return { key: 'all', name: 'all notes' };

    if (strategy === 'folder') {
      const parts = note.path.split('/').filter(Boolean);
      const top = parts.length > 1 ? parts[0] : '(root)';
      return { key: top, name: top };
    }

    if (strategy === 'top-tag') {
      if (!note.tags || note.tags.length === 0) return { key: '_untagged', name: 'untagged' };
      // pick the tag with the highest global count; tiebreak alpha
      const ranked = [...note.tags].sort((a, b) => (globalTagCount[b] - globalTagCount[a]) || a.localeCompare(b));
      const t = ranked[0];
      return { key: t, name: '#' + t };
    }

    if (strategy.startsWith('frontmatter:')) {
      const field = strategy.slice('frontmatter:'.length).toLowerCase();
      const fm = note.frontmatter || {};
      const val = fm[field];
      const v = Array.isArray(val) ? val[0] : val;
      if (!v) return { key: '_none', name: '(no ' + field + ')' };
      const slug = slugify(v);
      return { key: slug, name: String(v) };
    }

    return { key: 'all', name: 'all notes' };
  }

  // pass 1: bucket every note
  const bucketed = new Map();
  for (const n of notes) {
    const b = bucketFor(n);
    if (!bucketed.has(b.key)) bucketed.set(b.key, { key: b.key, name: b.name, notes: [] });
    bucketed.get(b.key).notes.push(n);
  }

  // pass 2 (folder strategy only): split oversize clusters by 2nd-level folder
  let buckets = [...bucketed.values()];
  if (strategy === 'folder') {
    const total = notes.length;
    const oversize = Math.max(50, total * 0.15);
    const next = [];
    for (const b of buckets) {
      if (b.notes.length > oversize) {
        const by2 = new Map();
        for (const n of b.notes) {
          const parts = n.path.split('/').filter(Boolean);
          const second = parts.length > 2 ? parts[1] : '(root)';
          if (!by2.has(second)) by2.set(second, []);
          by2.get(second).push(n);
        }
        const sub = [...by2.entries()];
        const significant = sub.filter(([_, ns]) => ns.length >= 10).length;
        if (significant >= 2) {
          for (const [second, ns] of sub) {
            const name = second === '(root)' ? b.key : `${b.key} / ${second}`;
            next.push({ key: `${b.key}/${second}`, name, notes: ns });
          }
        } else {
          next.push(b);
        }
      } else {
        next.push(b);
      }
    }
    buckets = next;
  }

  // pass 3 (top-tag / frontmatter strategies): merge tiny buckets into "other"
  if (strategy !== 'folder' && strategy !== 'flat') {
    const minSize = Math.max(3, Math.floor(notes.length * 0.005));
    const big = buckets.filter(b => b.notes.length >= minSize);
    const small = buckets.filter(b => b.notes.length < minSize);
    if (small.length > 0) {
      const merged = { key: '_other', name: 'other', notes: [].concat(...small.map(s => s.notes)) };
      buckets = [...big];
      if (merged.notes.length > 0) buckets.push(merged);
    }
  }

  buckets.sort((a, b) => b.notes.length - a.notes.length || a.name.localeCompare(b.name));

  const themes = buckets.map((b, i) => ({
    id: slugify(b.key) || ('cluster-' + i),
    name: b.name,
    folder: b.key,
    themeIdx: i,
    count: b.notes.length,
    tagPool: [],
    titles: [],
    color: seedColors[i % seedColors.length] || '#888',
  }));

  // assign each note to its bucket's themeIdx
  const themeIdxByKey = {};
  buckets.forEach((b, i) => { themeIdxByKey[b.key] = i; });
  for (const b of buckets) {
    for (const n of b.notes) {
      n.themeIdx = themeIdxByKey[b.key];
      const th = themes[n.themeIdx];
      n.theme = th.id;
      n.themeName = th.name;
      n.color = th.color;
    }
  }

  // reassign idxInTheme (sort by title within each cluster)
  themes.forEach(theme => {
    const inTheme = notes.filter(n => n.themeIdx === theme.themeIdx);
    inTheme.sort((a, b) => (a.displayTitle || a.title).localeCompare(b.displayTitle || b.title));
    inTheme.forEach((n, i) => { n.idxInTheme = i; });
    theme.titles = inTheme.map(n => n.displayTitle || n.title);
  });

  vault.themes = themes;
  vault.stats = {
    ...vault.stats,
    themeCount: themes.length,
  };
  vault._groupBy = strategy;
  return themes;
}

function cleanDisplayTitle(raw) {
  // Strip a leading YYYY-MM-DD or YYYY-MM-DD - prefix used for daily/dated notes.
  // Keep the original raw name on the note for path-resolution; this is display only.
  if (!raw) return raw;
  const m = raw.match(/^\d{4}-\d{2}-\d{2}\s*[-–—:]?\s*(.+)$/);
  if (m && m[1].trim().length >= 2) return m[1].trim();
  return raw;
}

window.cleanDisplayTitle = cleanDisplayTitle;
window.recomputeClusters = recomputeClusters;
