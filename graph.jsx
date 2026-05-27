/* ============================================================
   GRAPH — canvas + d3-force directed graph
   Theme-driven: bg, edges, node colors/shapes/glow all come from
   props.theme (see themes.js). Pan/zoom, hover/focus, lasso.
   ============================================================ */

const { useEffect, useRef, useState, useImperativeHandle, forwardRef } = React;

const NODE_BASE_R = 2.6;
const NODE_HUB_R = 6.5;
const NODE_MAX_R = 9;

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function hexA(hex, a) {
  if (!hex) return `rgba(128,128,128,${a})`;
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

const GraphCanvas = forwardRef(function GraphCanvas(props, ref) {
  const {
    vault,
    theme,
    selectedId,
    onSelectNode,
    onHoverNode,
    lassoMode,
    onLassoComplete,
    activeFilters,
    focusedIds,
  } = props;

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const dimsRef = useRef({ w: 800, h: 600 });
  const hoverRef = useRef(null);
  const dragRef = useRef(null);
  const lassoPathRef = useRef(null);
  const animRef = useRef(null);
  const tooltipRef = useRef(null);
  const flyRef = useRef(null);

  // refs that the RAF loop reads (avoids stale closures on prop changes)
  const themeRef = useRef(theme);
  const selectedRef = useRef(selectedId);
  const focusedRef = useRef(focusedIds);
  const filtersRef = useRef(activeFilters);
  const lassoSelRef = useRef(props.lassoSelection);

  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { focusedRef.current = focusedIds; }, [focusedIds]);
  useEffect(() => { filtersRef.current = activeFilters; }, [activeFilters]);
  useEffect(() => { lassoSelRef.current = props.lassoSelection; }, [props.lassoSelection]);

  const [zoomLevel, setZoomLevel] = useState(1);

  // ---------- build sim when vault changes ----------
  useEffect(() => {
    if (!vault) return;

    const themeAngles = {};
    vault.themes.forEach((t, i) => { themeAngles[t.id] = (i / vault.themes.length) * Math.PI * 2; });

    // scale layout radius with vault size so big vaults don't crunch into themselves
    const N = vault.notes.length;
    const ringR = Math.max(380, Math.sqrt(N) * 22);

    const nodes = vault.notes.map((n) => {
      const a = themeAngles[n.theme] + (Math.random() - 0.5) * 0.9;
      const r = ringR * (0.85 + Math.random() * 0.3);
      return {
        id: n.id, note: n,
        x: Math.cos(a) * r, y: Math.sin(a) * r,
        vx: 0, vy: 0,
        degree: n.outLinks.length + n.inLinks.length,
      };
    });
    const edges = vault.edges.map(e => ({ source: e.source, target: e.target }));

    nodesRef.current = nodes;
    edgesRef.current = edges;

    if (simRef.current) simRef.current.stop();

    // Tune force strengths to the size of the vault.
    // Big sparse vaults (low edges-per-node) need WEAKER clustering pull and
    // STRONGER link pull so the few connections actually shape the layout.
    const avgDeg = (edges.length * 2) / Math.max(1, N);
    const sparse = avgDeg < 2;
    const clusterStrength = sparse ? 0.012 : 0.04;
    const linkStrength = sparse ? 0.7 : 0.4;
    const linkDistance = sparse ? 70 : 45;
    const chargeStrength = sparse ? -160 : -90;
    const themeCenterScale = Math.max(280, ringR * 0.55);

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(linkDistance).strength(linkStrength))
      .force('charge', d3.forceManyBody().strength(chargeStrength).distanceMax(900))
      .force('center', d3.forceCenter(0, 0).strength(0.02))
      .force('collide', d3.forceCollide().radius(d => (d.note.isHub ? NODE_HUB_R : NODE_BASE_R) + 3).strength(0.7))
      .force('x', d3.forceX(d => Math.cos(themeAngles[d.note.theme]) * themeCenterScale).strength(clusterStrength))
      .force('y', d3.forceY(d => Math.sin(themeAngles[d.note.theme]) * themeCenterScale).strength(clusterStrength))
      .alphaDecay(0.015)
      .velocityDecay(0.4);
    simRef.current = sim;
    // longer warm-up for bigger vaults
    const warmup = Math.min(180, 60 + Math.floor(N / 30));
    for (let i = 0; i < warmup; i++) sim.tick();
    sim.alpha(0.9).restart();
    return () => { sim.stop(); };
  }, [vault]);

  // ---------- canvas resize ----------
  useEffect(() => {
    function resize() {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const c = canvasRef.current;
      if (!c) return;
      c.width = r.width * dpr; c.height = r.height * dpr;
      c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimsRef.current = { w: r.width, h: r.height, dpr };
      if (!transformRef.current._init) {
        transformRef.current = { x: r.width / 2, y: r.height / 2, k: 0.8, _init: true };
        setZoomLevel(0.8);
      }
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ---------- render loop ----------
  useEffect(() => {
    let stopped = false;
    function tick() {
      if (stopped) return;
      if (flyRef.current) {
        const fly = flyRef.current;
        const now = performance.now();
        const t = Math.min(1, (now - fly.startTime) / fly.duration);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        transformRef.current.x = fly.fromX + (fly.toX - fly.fromX) * ease;
        transformRef.current.y = fly.fromY + (fly.toY - fly.fromY) * ease;
        transformRef.current.k = fly.fromK + (fly.toK - fly.fromK) * ease;
        setZoomLevel(transformRef.current.k);
        if (t >= 1) flyRef.current = null;
      }
      draw();
      animRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => { stopped = true; if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  // ---------- drawing ----------
  function draw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const { w, h } = dimsRef.current;
    const th = themeRef.current;
    if (!th) return;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, w, h);
    drawGrid(ctx, w, h, th);

    const T = transformRef.current;
    ctx.save();
    ctx.translate(T.x, T.y);
    ctx.scale(T.k, T.k);

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const sel = selectedRef.current;
    const hov = hoverRef.current;
    const focus = focusedRef.current;
    const filters = filtersRef.current;
    const filterActive = filters && (filters.themes.size > 0 || filters.tags.size > 0 || (filters.search && filters.search.length > 0));
    const lassoSel = lassoSelRef.current;
    const lassoActive = lassoSel && lassoSel.size > 0;

    function nodeVisible(n) {
      if (!filterActive) return true;
      if (filters.themes.size && !filters.themes.has(n.note.theme)) return false;
      if (filters.tags.size && !n.note.tags.some(t => filters.tags.has(t))) return false;
      if (filters.search && filters.search.length > 0) {
        const q = filters.search.toLowerCase();
        if (!n.note.displayTitle && !n.note.title) return false;
        const hay = ((n.note.displayTitle || '') + ' ' + (n.note.title || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }

    // -------- edges --------
    ctx.lineWidth = 0.6 / T.k;
    for (const e of edges) {
      const s = typeof e.source === 'object' ? e.source : null;
      const t = typeof e.target === 'object' ? e.target : null;
      if (!s || !t) continue;

      const sVis = nodeVisible(s), tVis = nodeVisible(t);
      const sFocus = focus ? focus.has(s.id) : true;
      const tFocus = focus ? focus.has(t.id) : true;
      const sLasso = lassoActive ? lassoSel.has(s.id) : true;
      const tLasso = lassoActive ? lassoSel.has(t.id) : true;

      let color;
      if ((sel && (s.id === sel || t.id === sel)) || (hov && (s.id === hov || t.id === hov))) {
        color = th.edgeFocus;
        ctx.lineWidth = 1.2 / T.k;
      } else if (focus && (sFocus || tFocus)) {
        color = th.edgeFocus.includes(')')
            ? th.edgeFocus.replace(/[\d.]+\)$/, '0.45)')
            : th.edgeFocus + '73';
        ctx.lineWidth = 0.7 / T.k;
      } else if (filterActive && (!sVis || !tVis)) {
        color = th.edgeDim;
        ctx.lineWidth = 0.4 / T.k;
      } else if (lassoActive && (!sLasso || !tLasso)) {
        color = th.edgeDim;
        ctx.lineWidth = 0.4 / T.k;
      } else {
        color = focus ? th.edgeDim : th.edge;
        ctx.lineWidth = 0.55 / T.k;
      }

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }

    // -------- nodes (4 passes) --------
    const pass = [[], [], [], []];
    for (const n of nodes) {
      const visible = nodeVisible(n);
      const inFocus = focus ? focus.has(n.id) : true;
      const inLasso = lassoActive ? lassoSel.has(n.id) : true;
      if (n.id === sel || n.id === hov) pass[3].push(n);
      else if (!visible || !inFocus || !inLasso) pass[0].push(n);
      else if (focus || lassoActive) pass[2].push(n);
      else pass[1].push(n);
    }

    pass[0].forEach(n => drawNode(ctx, n, 'dim', th, T));
    pass[1].forEach(n => drawNode(ctx, n, 'normal', th, T));
    pass[2].forEach(n => drawNode(ctx, n, 'focus', th, T));
    pass[3].forEach(n => drawNode(ctx, n, 'hot', th, T));

    // -------- hub labels --------
    if (T.k > (th.showLabelsAt || 0.6)) {
      ctx.font = labelFont(th, 11 / T.k);
      ctx.textBaseline = 'top';
      const labelColor = th.id === 'brutalist' || th.id === 'atlas' ? '#0a0a0a' : '#ffffff';
      ctx.fillStyle = hexA(labelColor, Math.min(1, (T.k - (th.showLabelsAt || 0.6)) * 2));
      for (const n of nodes) {
        if (!n.note.isHub) continue;
        if (filterActive && !nodeVisible(n)) continue;
        ctx.fillText(n.note.displayTitle || n.note.title, n.x + 8, n.y - 4);
      }
    }
    // selected / hovered labels (always when zoomed enough)
    if (T.k > 0.35) {
      ctx.font = labelFont(th, 12 / T.k, true);
      const labelColor = th.id === 'brutalist' ? '#0a0a0a' : (th.id === 'atlas' ? '#2a1d0c' : '#ffffff');
      ctx.fillStyle = labelColor;
      for (const n of nodes) {
        if (n.id === sel || n.id === hov) {
          ctx.save();
          if (th.nodeGlow) {
            ctx.shadowColor = th.clusters[n.note.themeIdx] || th.swatch;
            ctx.shadowBlur = 6;
          }
          ctx.fillText(n.note.displayTitle || n.note.title, n.x + 10, n.y - 5);
          ctx.restore();
        }
      }
    }

    ctx.restore();

    // lasso polygon (screen-space)
    if (lassoPathRef.current && lassoPathRef.current.length > 1) {
      const path = lassoPathRef.current;
      const lassoColor = th.id === 'brutalist' ? '#ff3a00' : '#ffb84a';
      ctx.strokeStyle = hexA(lassoColor, 0.95);
      ctx.fillStyle = hexA(lassoColor, 0.06);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function labelFont(th, size, bold = false) {
    const fam = (th.id === 'phosphor') ? 'JetBrains Mono, monospace'
              : (th.id === 'atlas') ? '"Crimson Pro", Georgia, serif'
              : (th.id === 'brutalist') ? '"Space Grotesk", system-ui, sans-serif'
              : '"IBM Plex Sans", system-ui, sans-serif';
    return `${bold ? 'bold ' : ''}${Math.max(9, size)}px ${fam}`;
  }

  function drawNode(ctx, n, mode, th, T) {
    const r = n.note.isHub ? NODE_HUB_R : NODE_BASE_R + Math.min(NODE_MAX_R - NODE_BASE_R, n.degree * 0.3);
    const color = th.clusters[n.note.themeIdx] || th.swatch;
    const shape = th.nodeShape || 'circle';
    const style = th.nodeStyle || 'filled';

    ctx.beginPath();
    if (shape === 'square') {
      ctx.rect(n.x - r, n.y - r, r * 2, r * 2);
    } else {
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    }

    if (mode === 'dim') {
      ctx.fillStyle = hexA(th.id === 'atlas' ? '#a89270' : (th.id === 'brutalist' ? '#bbbbb6' : '#5a6a72'), 0.45);
      ctx.fill();
      if (style === 'outlined' || style === 'outlined-thick') {
        ctx.lineWidth = 0.6 / T.k;
        ctx.strokeStyle = hexA(th.nodeStroke, 0.3);
        ctx.stroke();
      }
      return;
    }

    if (style === 'outlined-thick') {
      // brutalist — filled with cluster color + thick black border
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = (mode === 'hot' ? 2.4 : 1.6) / T.k;
      ctx.strokeStyle = th.nodeStroke;
      ctx.stroke();
      if (mode === 'hot') {
        // selection ring outside
        ctx.beginPath();
        if (shape === 'square') ctx.rect(n.x - r - 3, n.y - r - 3, r*2 + 6, r*2 + 6);
        else ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 1.5 / T.k;
        ctx.strokeStyle = th.edgeFocus;
        ctx.stroke();
      }
      return;
    }

    if (style === 'outlined') {
      // atlas — outlined ink dots
      ctx.fillStyle = hexA(th.bg, 0.9);
      ctx.fill();
      ctx.lineWidth = (mode === 'hot' ? 2 : 1.1) / T.k;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (mode === 'hot') {
        ctx.beginPath();
        if (shape === 'square') ctx.rect(n.x - r - 2, n.y - r - 2, r*2 + 4, r*2 + 4);
        else ctx.arc(n.x, n.y, r + 2, 0, Math.PI * 2);
        ctx.lineWidth = 0.8 / T.k;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      return;
    }

    if (style === 'inkfilled') {
      // atlas — saturated filled circles with a thin sepia-ink outline.
      // No glow even on hot; the hot ring is a second dark stroke.
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = (mode === 'hot' ? 1.4 : 0.5) / T.k;
      ctx.strokeStyle = th.nodeStroke;
      ctx.stroke();
      if (mode === 'hot') {
        ctx.beginPath();
        if (shape === 'square') ctx.rect(n.x - r - 2.5, n.y - r - 2.5, r*2 + 5, r*2 + 5);
        else ctx.arc(n.x, n.y, r + 2.5, 0, Math.PI * 2);
        ctx.lineWidth = 0.9 / T.k;
        ctx.strokeStyle = th.nodeStroke;
        ctx.stroke();
      }
      return;
    }

    if (style === 'star') {
      // constellation — bright core + colored halo (drawn as glow)
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = mode === 'hot' ? 18 : (n.note.isHub ? 14 : 8);
      ctx.fillStyle = mode === 'hot' ? '#ffffff' : color;
      ctx.fill();
      ctx.restore();
      // tiny white core
      ctx.beginPath();
      if (shape === 'square') ctx.rect(n.x - r * 0.4, n.y - r * 0.4, r * 0.8, r * 0.8);
      else ctx.arc(n.x, n.y, Math.max(1, r * 0.45), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }

    if (style === 'filled-soft') {
      // linear — soft filled with subtle border
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 0.6 / T.k;
      ctx.strokeStyle = hexA('#ffffff', 0.18);
      ctx.stroke();
      if (mode === 'hot') {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      }
      return;
    }

    // default — filled (phosphor)
    if (mode === 'hot') {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = th.hotFill || '#ffffff';
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 1.2 / T.k;
      ctx.strokeStyle = color;
      ctx.stroke();
    } else if (mode === 'focus') {
      ctx.fillStyle = hexA(color, 0.95);
      ctx.fill();
      ctx.lineWidth = 0.8 / T.k;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else {
      ctx.fillStyle = hexA(color, 0.85);
      ctx.fill();
      ctx.lineWidth = 0.4 / T.k;
      ctx.strokeStyle = hexA(color, 1);
      ctx.stroke();
    }
  }

  function drawGrid(ctx, w, h, th) {
    const T = transformRef.current;
    const step = 60 * T.k;
    if (step < 20) return;
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 0.5;
    const offX = T.x % step, offY = T.y % step;
    ctx.beginPath();
    for (let x = offX; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = offY; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  // ---------- hit testing ----------
  function screenToWorld(sx, sy) {
    const T = transformRef.current;
    return [(sx - T.x) / T.k, (sy - T.y) / T.k];
  }
  function findNodeAt(sx, sy) {
    const [wx, wy] = screenToWorld(sx, sy);
    const T = transformRef.current;
    let best = null, bestD = Infinity;
    for (const n of nodesRef.current) {
      const r = (n.note.isHub ? NODE_HUB_R : NODE_BASE_R + Math.min(NODE_MAX_R - NODE_BASE_R, n.degree * 0.3));
      const hitR = Math.max(r + 3 / T.k, 8 / T.k);
      const dx = wx - n.x, dy = wy - n.y;
      const d = dx*dx + dy*dy;
      if (d < hitR * hitR && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  // ---------- mouse handlers ----------
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let panning = false, panStart = null, lassoActive = false;

    function onMouseDown(e) {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (lassoMode || e.shiftKey) {
        lassoActive = true;
        lassoPathRef.current = [[sx, sy]];
        c.classList.add('lasso');
        return;
      }
      const n = findNodeAt(sx, sy);
      if (n) {
        dragRef.current = { node: n, sx, sy, moved: false };
        n.fx = n.x; n.fy = n.y;
        if (simRef.current) simRef.current.alphaTarget(0.3).restart();
      } else {
        panning = true;
        panStart = { x: sx, y: sy, tx: transformRef.current.x, ty: transformRef.current.y };
        c.classList.add('dragging');
      }
    }
    function onMouseMove(e) {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (lassoActive) { lassoPathRef.current.push([sx, sy]); return; }
      if (dragRef.current) {
        const { node } = dragRef.current;
        const [wx, wy] = screenToWorld(sx, sy);
        node.fx = wx; node.fy = wy;
        dragRef.current.moved = true;
        return;
      }
      if (panning) {
        transformRef.current.x = panStart.tx + (sx - panStart.x);
        transformRef.current.y = panStart.ty + (sy - panStart.y);
        return;
      }
      const n = findNodeAt(sx, sy);
      hoverRef.current = n ? n.id : null;
      if (tooltipRef.current) {
        if (n) {
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = (sx + 12) + 'px';
          tooltipRef.current.style.top = (sy + 12) + 'px';
          tooltipRef.current.innerHTML =
            `${escapeHtml(n.note.displayTitle || n.note.title)}<br><span class="tag">${escapeHtml(n.note.themeName)} · ${n.note.outLinks.length + n.note.inLinks.length} links</span>`;
        } else { tooltipRef.current.style.display = 'none'; }
      }
      onHoverNode && onHoverNode(n ? n.id : null);
      c.style.cursor = n ? 'pointer' : (lassoMode ? 'crosshair' : 'grab');
    }
    function onMouseUp(e) {
      if (lassoActive) {
        const path = lassoPathRef.current;
        if (path && path.length > 5) {
          const worldPath = path.map(([x, y]) => screenToWorld(x, y));
          const hits = nodesRef.current.filter(n => pointInPolygon(n.x, n.y, worldPath));
          onLassoComplete && onLassoComplete(hits.map(n => n.id));
        }
        lassoPathRef.current = null; lassoActive = false;
        c.classList.remove('lasso');
        return;
      }
      if (dragRef.current) {
        const { node, moved } = dragRef.current;
        node.fx = null; node.fy = null;
        if (simRef.current) simRef.current.alphaTarget(0);
        if (!moved) onSelectNode && onSelectNode(node.id);
        dragRef.current = null;
      } else if (panning) {
        panning = false;
        c.classList.remove('dragging');
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const dx = sx - panStart.x, dy = sy - panStart.y;
        if (dx*dx + dy*dy < 9) onSelectNode && onSelectNode(null);
      }
    }
    function onWheel(e) {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const T = transformRef.current;
      const delta = -e.deltaY * 0.0015;
      const newK = Math.max(0.15, Math.min(5, T.k * Math.exp(delta)));
      const k = newK / T.k;
      T.x = sx - (sx - T.x) * k; T.y = sy - (sy - T.y) * k; T.k = newK;
      setZoomLevel(newK);
    }
    function onLeave() {
      hoverRef.current = null;
      if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      onHoverNode && onHoverNode(null);
    }
    c.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('mouseleave', onLeave);
    return () => {
      c.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('mouseleave', onLeave);
    };
  }, [lassoMode, onSelectNode, onHoverNode, onLassoComplete]);

  useImperativeHandle(ref, () => ({
    flyTo(nodeId, zoom = 1.6) {
      const n = nodesRef.current.find(x => x.id === nodeId);
      if (!n) return;
      const { w, h } = dimsRef.current;
      const T = transformRef.current;
      flyRef.current = {
        fromX: T.x, fromY: T.y, fromK: T.k,
        toX: w / 2 - n.x * zoom, toY: h / 2 - n.y * zoom, toK: zoom,
        startTime: performance.now(), duration: 700,
      };
    },
    resetView() {
      const { w, h } = dimsRef.current;
      const T = transformRef.current;
      flyRef.current = {
        fromX: T.x, fromY: T.y, fromK: T.k,
        toX: w / 2, toY: h / 2, toK: 0.65,
        startTime: performance.now(), duration: 500,
      };
    },
    zoomBy(factor) {
      const { w, h } = dimsRef.current;
      const T = transformRef.current;
      const newK = Math.max(0.15, Math.min(5, T.k * factor));
      const k = newK / T.k;
      T.x = w/2 - (w/2 - T.x) * k; T.y = h/2 - (h/2 - T.y) * k; T.k = newK;
      setZoomLevel(newK);
    },
    reheat() { if (simRef.current) simRef.current.alpha(0.6).restart(); },
  }), []);

  return (
    <div ref={containerRef} className="graph" style={{position:'relative', width:'100%', height:'100%'}}>
      <canvas ref={canvasRef} />
      <div ref={tooltipRef} className="tooltip" style={{display:'none', position:'absolute'}}></div>
      <div className="graph-overlay">
        <div className="graph-zoom">zoom {Math.round(zoomLevel * 100)}%</div>
      </div>
    </div>
  );
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

window.GraphCanvas = GraphCanvas;
