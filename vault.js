/* ============================================================
   VAULT GENERATOR
   Reads window.VAULT_DATA and produces:
     VAULT.notes  — full note objects { id, title, theme, color,
                    folder, path, tags, body, outLinks, inLinks }
     VAULT.edges  — { source, target, kind }
     VAULT.tags   — [{ name, count, color }]
     VAULT.themes — passthrough with counts
     VAULT.byId   — map for lookup
   ============================================================ */

(function () {
  // --- include the data file synchronously
  const DATA = window.VAULT_DATA;
  if (!DATA) { console.error('VAULT_DATA missing'); return; }

  // deterministic hash from a string (mulberry-style)
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }
  function rand(seed) { // returns [0,1)
    let s = seed >>> 0;
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function slugify(s) {
    return s.toLowerCase()
      .replace(/[\u2018\u2019']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }
  function pick(arr, seed) { return arr[Math.floor(rand(seed) * arr.length)]; }
  function pickN(arr, n, seed) {
    const out = [];
    const copy = arr.slice();
    for (let i = 0; i < n && copy.length; i++) {
      const idx = Math.floor(rand(seed + i * 7) * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  }

  // ---- BUILD NOTES ----
  const notes = [];
  const byId = {};
  const titleToId = {};

  DATA.themes.forEach((theme, themeIdx) => {
    theme.titles.forEach((title, idx) => {
      const id = slugify(title);
      const tagCount = 1 + (hash(id) % 3); // 1-3 tags
      const tags = pickN(theme.tagPool, tagCount, hash(id + 't'));
      const note = {
        id,
        title,
        theme: theme.id,
        themeName: theme.name,
        color: theme.color,
        folder: theme.folder,
        path: `${theme.folder}/${title.replace(/[/\\?%*:|"<>]/g, '')}.md`,
        idxInTheme: idx,
        themeIdx,
        tags,
        outLinks: [],
        inLinks: [],
        body: '',
        wordCount: 0,
        created: 1700000000000 + (hash(id) % 31536000000),
      };
      notes.push(note);
      byId[id] = note;
      titleToId[title.toLowerCase()] = id;
    });
  });

  // ---- BUILD LINK GRAPH ----
  // Strategy: for each note, pick 2-5 link targets, mostly within-theme nearby,
  // 18% chance of cross-theme bridge per note (per slot).

  function notesInTheme(themeId) { return notes.filter(n => n.theme === themeId); }

  notes.forEach((note, i) => {
    const seed = hash(note.id + ':links');
    const isHub = note.idxInTheme === 0 || (note.idxInTheme === 1 && rand(seed) < 0.5);
    const linkCount = isHub
      ? 6 + Math.floor(rand(seed) * 8)            // hubs: 6-13 links
      : 2 + Math.floor(rand(seed + 1) * 4);       // regular: 2-5

    const sameTheme = notesInTheme(note.theme).filter(n => n.id !== note.id);
    // sort by proximity in topic order
    sameTheme.sort((a, b) => Math.abs(a.idxInTheme - note.idxInTheme) - Math.abs(b.idxInTheme - note.idxInTheme));

    const links = new Set();
    for (let k = 0; k < linkCount; k++) {
      const r = rand(seed + k * 11);
      if (r < 0.18 && !isHub) {
        // cross-theme bridge
        const others = notes.filter(n => n.theme !== note.theme);
        const target = others[Math.floor(rand(seed + k * 13 + 3) * others.length)];
        if (target) links.add(target.id);
      } else if (isHub) {
        // hubs pull broadly within theme
        const span = Math.min(sameTheme.length, 1 + Math.floor(rand(seed + k * 5) * sameTheme.length));
        const t = sameTheme[Math.floor(rand(seed + k * 17) * span)];
        if (t) links.add(t.id);
      } else {
        // regular: prefer nearby
        const span = Math.min(sameTheme.length, 1 + Math.floor(rand(seed + k * 19) * 7));
        const t = sameTheme[Math.floor(rand(seed + k * 23) * span)];
        if (t) links.add(t.id);
      }
    }

    note.isHub = isHub;
    note.outLinks = [...links];
  });

  // Compute inLinks
  notes.forEach(n => {
    for (const target of n.outLinks) {
      if (byId[target]) byId[target].inLinks.push(n.id);
    }
  });

  // ---- BODY GENERATION ----
  // Per-theme phrase banks — generic enough to read naturally,
  // specific enough to feel like real notes in that domain.
  const phraseBanks = {
    mind: {
      openers: [
        'A useful frame: think of this as a stance, not a thing.',
        'Worth distinguishing the metaphysical claim from the methodological one.',
        'The phrasing matters here — \"about\" hides real philosophical weight.',
        'Comes up again and again when arguing with a functionalist.',
        'Useful to remember when reading anything in the consciousness literature.',
      ],
      mid: [
        'The crux for me is the explanatory gap.',
        'I keep coming back to whether this dissolves under careful re-description.',
        'Suspicion: this is a verbal dispute disguised as a substantive one.',
        'The interesting move is to treat the puzzle as an artifact of how we model ourselves.',
        'If you grant the first premise, the rest follows trivially.',
      ],
      closers: [
        'Open question: would this even occur to a system without language?',
        'Suspect this becomes harder once you take embodiment seriously.',
        'Need to revisit after re-reading Dennett.',
      ],
    },
    ml: {
      openers: [
        'Standard piece of the modern stack, but the intuition is what matters.',
        'Easy to use mechanically; harder to articulate *why* it works.',
        'The math is one paragraph; the implications take years.',
        'Worth re-deriving from scratch every couple of years.',
      ],
      mid: [
        'In practice the implementation is dominated by a single trick.',
        'Most papers that beat this turn out to be tuning, not insight.',
        'The story we tell ourselves about why this works is mostly post-hoc.',
        'Failure modes are far more interesting than the success cases.',
      ],
      closers: [
        'TODO: build a tiny version from scratch in a notebook.',
        'See the original paper for the actual derivation.',
        'Open thread: does this scale, or is it a small-model phenomenon?',
      ],
    },
    info: {
      openers: [
        'A surprisingly large fraction of ML reduces to a restatement of this.',
        'One of those ideas that\u2019s simpler than its reputation.',
        'Shannon\u2019s framing is still the cleanest place to start.',
      ],
      mid: [
        'The bound feels tight until you find the right re-encoding.',
        'Worth checking: is this lossless or lossy?',
        'The interesting cases sit right at the edge of the bound.',
      ],
      closers: [
        'Underused outside of EE and ML.',
        'Pairs nicely with anything Bayesian.',
      ],
    },
    writing: {
      openers: [
        'A rule worth knowing well enough to break.',
        'More useful as a diagnostic than as a prescription.',
        'Sounds obvious until you try to apply it under deadline.',
      ],
      mid: [
        'The trick is doing this without telegraphing the move.',
        'Cut everything that doesn\u2019t change the temperature of the page.',
        'If the reader notices the technique, you\u2019ve done it wrong.',
      ],
      closers: [
        'See any of the usual suspects on style.',
        'Test: read it aloud.',
        'Worth re-applying to last week\u2019s draft.',
      ],
    },
    cogsci: {
      openers: [
        'A surprisingly robust finding, but the textbook gloss oversimplifies.',
        'The phenomenon is easier to demonstrate than to explain.',
        'Sits at the seam between psychology proper and neuroscience.',
      ],
      mid: [
        'Effect sizes shrink the harder you look for them.',
        'The classical study replicates; the interpretation is contested.',
        'Note that \"automatic\" here is a technical, not folk, term.',
      ],
      closers: [
        'Cross-reference with anything on attention.',
        'Replication notes pending.',
      ],
    },
    arch: {
      openers: [
        'Sounds like architecture; usually it\u2019s organizational.',
        'A pattern, not a religion.',
        'The tradeoffs are well-known. The team\u2019s discipline is what varies.',
      ],
      mid: [
        'Every team rediscovers this the hard way.',
        'The failure mode is more important than the happy path.',
        'Look for the implicit coupling before celebrating the explicit decoupling.',
      ],
      closers: [
        'Useful only at a certain scale.',
        'TODO: draw the failure scenario as a sequence diagram.',
        'See also: anything with the word \"eventual\" in it.',
      ],
    },
    urban: {
      openers: [
        'Jacobs is right about almost everything, even where she\u2019s wrong about specifics.',
        'A pattern visible at a glance once you know to look.',
        'The kind of intervention that looks small on a plan and huge on the ground.',
      ],
      mid: [
        'The political fight is more interesting than the urbanist one.',
        'Compare cities that did this with cities that didn\u2019t — the difference shows up in 20 years.',
        'Mode share data tells you more than aesthetics ever will.',
      ],
      closers: [
        'Walk it before having an opinion.',
        'Worth a field trip.',
      ],
    },
    music: {
      openers: [
        'Old idea, still useful.',
        'Easy to explain on paper, harder to hear without practice.',
        'Theory follows practice here, as usual.',
      ],
      mid: [
        'The notation conceals what the ear actually does.',
        'Sing the line before analyzing it.',
        'Players talk about this differently than theorists do.',
      ],
      closers: [
        'Transcribe a chorus that uses it.',
        'See the usual jazz pedagogy references.',
      ],
    },
    cook: {
      openers: [
        'Less mysterious once you understand the chemistry.',
        'Technique trumps recipe.',
        'The science explains why grandma was right.',
      ],
      mid: [
        'Temperature and time are doing most of the work.',
        'Most failures here are a salt or acid problem.',
        'The visual cue lies; trust the thermometer.',
      ],
      closers: [
        'Try this on something cheap before something expensive.',
        'Log the result in the cooking journal.',
      ],
    },
    math: {
      openers: [
        'Definitions are doing the heavy lifting. Read them twice.',
        'The picture you draw determines what you can prove.',
        'Worth re-deriving rather than re-reading.',
      ],
      mid: [
        'The naturality condition is where it actually clicks.',
        'Notation is hiding the structure. Switch coordinates.',
        'Two unrelated proofs of the same theorem are usually worth more than one.',
      ],
      closers: [
        'Exercise: find a counterexample at the boundary.',
        'See the standard reference.',
      ],
    },
    hist: {
      openers: [
        'Easy to flatten into a textbook story. The actual sequence was messier.',
        'The standard narrative leaves out at least three serious competitors.',
        'Worth reading the primary sources, not the secondary ones.',
      ],
      mid: [
        'Priority disputes obscure what was actually invented when.',
        'The instrument shaped the question more than the theory did.',
        'The losing side\u2019s arguments were better than they\u2019re given credit for.',
      ],
      closers: [
        'Compare with the parallel development elsewhere.',
        'Reference: any modern history of the period.',
      ],
    },
    prod: {
      openers: [
        'A method only works if you actually use it.',
        'Most of the value is in the constraint, not the tool.',
        'Half the systems out there are the same idea in different costumes.',
      ],
      mid: [
        'The friction point is review, not capture.',
        'Default to atomic. Combine later.',
        'Tooling churn is a tax on thinking.',
      ],
      closers: [
        'Revisit during weekly review.',
        'Resist the urge to retool.',
      ],
    },
  };

  // generic bullet phrases (theme-flavored)
  function bullets(note, themeBank, seed) {
    const out = [];
    const n = 2 + Math.floor(rand(seed) * 2);
    const pool = [...themeBank.openers, ...themeBank.mid, ...themeBank.closers];
    for (let i = 0; i < n; i++) {
      out.push(pool[Math.floor(rand(seed + i * 31) * pool.length)]);
    }
    return out;
  }

  function wikilink(targetNote, alias) {
    // standard obsidian wikilink, optionally aliased
    if (!targetNote) return '';
    if (alias && alias !== targetNote.title) return `[[${targetNote.title}|${alias}]]`;
    return `[[${targetNote.title}]]`;
  }

  function renderBody(note) {
    const seed = hash(note.id + ':body');
    const bank = phraseBanks[note.theme] || phraseBanks.mind;
    const outLinkNotes = note.outLinks.map(id => byId[id]).filter(Boolean);

    // structural variants
    const variant = Math.floor(rand(seed) * 5);

    const tagLine = note.tags.map(t => `#${t}`).join(' ');
    const opener = bank.openers[Math.floor(rand(seed + 1) * bank.openers.length)];
    const mid = bank.mid[Math.floor(rand(seed + 2) * bank.mid.length)];
    const closer = bank.closers[Math.floor(rand(seed + 3) * bank.closers.length)];

    // weave two wikilinks into the body
    const w1 = outLinkNotes[0];
    const w2 = outLinkNotes[1] || outLinkNotes[0];
    const woven = outLinkNotes.length
      ? `Connects to ${wikilink(w1)}${w2 && w2 !== w1 ? ` and ${wikilink(w2)}` : ''}.`
      : '';

    let body = '';

    if (note.isHub) {
      // MOC-style hub note
      body += `${tagLine}\n\n`;
      body += `# ${note.title}\n\n`;
      body += `An entry point into ${note.themeName.toLowerCase()}. ${opener}\n\n`;
      body += `## Map\n\n`;
      outLinkNotes.slice(0, 12).forEach(n => {
        body += `- ${wikilink(n)}\n`;
      });
      body += `\n## Notes\n\n`;
      body += `- ${mid}\n`;
      body += `- ${closer}\n`;
      if (outLinkNotes[3]) body += `- Particularly worth re-reading: ${wikilink(outLinkNotes[3])}.\n`;
    } else if (variant === 0) {
      // Definition + related
      body += `${tagLine}\n\n`;
      body += `${opener} ${woven}\n\n`;
      body += `## Related\n\n`;
      outLinkNotes.slice(0, 5).forEach(n => {
        const seedR = hash(note.id + n.id);
        const reason = pick([
          'directly upstream',
          'often confused with this',
          'the contrast case',
          'mentioned in the same breath',
          'a sharper version of the same point',
          'the historical predecessor',
          'see also',
        ], seedR);
        body += `- ${wikilink(n)} — ${reason}\n`;
      });
      body += `\n${closer}\n`;
    } else if (variant === 1) {
      // Question-style
      body += `${tagLine}\n\n`;
      body += `> ${opener}\n\n`;
      body += `${mid} ${woven}\n\n`;
      body += `## Open\n\n`;
      const qs = pickN(bank.openers.concat(bank.mid, bank.closers), 2, hash(note.id+'q'));
      qs.forEach(q => body += `- ${q}\n`);
      if (outLinkNotes.length > 2) {
        body += `\nSee also: ${outLinkNotes.slice(2, 5).map(n => wikilink(n)).join(', ')}.\n`;
      }
    } else if (variant === 2) {
      // Terse / bullets
      body += `${tagLine}\n\n`;
      body += `${opener}\n\n`;
      bullets(note, bank, seed).forEach(b => body += `- ${b}\n`);
      if (outLinkNotes.length) {
        body += `\n---\n\n`;
        body += outLinkNotes.slice(0, 4).map(n => `- ${wikilink(n)}`).join('\n') + '\n';
      }
    } else if (variant === 3) {
      // Short essay
      body += `${tagLine}\n\n`;
      body += `${opener}\n\n`;
      body += `${mid}\n\n`;
      if (outLinkNotes.length) {
        body += `The link to ${wikilink(outLinkNotes[0])} is the one I keep returning to — `;
        body += `the relationship is closer than people think.`;
        if (outLinkNotes[1]) body += ` Compare with ${wikilink(outLinkNotes[1])}.`;
        body += `\n\n`;
      }
      body += `${closer}\n`;
    } else {
      // Quote + reflection
      body += `${tagLine}\n\n`;
      body += `${opener}\n\n`;
      body += `> ${mid}\n\n`;
      body += `${woven}\n\n`;
      if (outLinkNotes[2]) {
        body += `Adjacent: ${wikilink(outLinkNotes[2])}${outLinkNotes[3] ? `, ${wikilink(outLinkNotes[3])}` : ''}.\n`;
      }
      body += `\n${closer}\n`;
    }

    note.wordCount = body.split(/\s+/).length;
    return body;
  }

  notes.forEach(n => { n.body = renderBody(n); n.displayTitle = n.title; });

  // ---- EDGES ----
  const edges = [];
  notes.forEach(n => {
    n.outLinks.forEach(targetId => {
      if (byId[targetId]) {
        edges.push({ source: n.id, target: targetId, kind: 'wikilink' });
      }
    });
  });

  // ---- TAGS (aggregated, with primary theme color) ----
  const tagMap = {};
  notes.forEach(n => {
    n.tags.forEach(t => {
      if (!tagMap[t]) tagMap[t] = { name: t, count: 0, color: n.color, themes: {} };
      tagMap[t].count++;
      tagMap[t].themes[n.theme] = (tagMap[t].themes[n.theme] || 0) + 1;
    });
  });
  const tags = Object.values(tagMap).sort((a, b) => b.count - a.count);

  // ---- THEME COUNTS ----
  const themes = DATA.themes.map(t => ({
    ...t,
    count: notes.filter(n => n.theme === t.id).length,
  }));

  window.VAULT = {
    notes,
    edges,
    tags,
    themes,
    byId,
    titleToId,
    groupableFmFields: [],
    stats: {
      noteCount: notes.length,
      edgeCount: edges.length,
      tagCount: tags.length,
      themeCount: themes.length,
      hubCount: notes.filter(n => n.isHub).length,
    },
  };

  // expose handy helpers
  window.VAULT.findByTitle = function (t) {
    if (!t) return null;
    const id = titleToId[t.toLowerCase()];
    return id ? byId[id] : null;
  };

  console.log('VAULT built:', window.VAULT.stats);
})();
