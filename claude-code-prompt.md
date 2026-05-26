# Claude Code prompt — retrofit vault connectivity conventions

Paste this into Claude Code from your vault root (the `brain/` directory). It runs in three phases, asks for your approval between phases, and never overwrites existing connectivity blocks — only adds them where missing.

---

You are operating against this Obsidian vault. Your job is to enrich the graph of connections between notes by adding three conventions to existing notes, in three phases. **Do not modify any note content outside the blocks you are creating.** Preserve all frontmatter, all existing wikilinks, and all body text.

Conventions you are applying (full spec in `vault-conventions.md` if present):

1. **`## See also`** — 2-4 wikilinks to closest related peers, appended to body if absent
2. **`## Adjacent work`** — 2-5 outward-pointing wikilinks, appended to every `context.md` if absent
3. **Multi-value semantic tags** — `topics:`, `concepts:`, `mentions:` in frontmatter; 3-8 values total per note

## Operating rules

- Walk the vault tree. Ignore `.obsidian/`, `.git/`, `_archive/`, and anything starting with `.`
- For every `.md` file, parse frontmatter and body separately
- When in doubt, **leave the note alone** and log it in a `connectivity-retrofit.log` file at the vault root listing skipped notes and reasons
- After each phase, write a summary to `connectivity-retrofit.log` and **stop** so I can review before continuing

## Wikilink form

- Use `[[basename]]` when the basename is unambiguous vault-wide
- Use `[[folder/basename]]` when the basename collides with notes in another folder
- Never link to a note's own children-by-folder; pick *peers*

---

## Phase 1 — `## See also` blocks

For every note that does **not** already contain a `## See also` heading (case-insensitive):

1. Read the note's title, tags, and first ~500 words of body
2. Identify 2-4 best-related peer notes from the rest of the vault using these signals, in priority order:
   - Same frontmatter `venture`, `client`, or `tier`
   - Shared `topics:` / `concepts:` / `mentions:` (once Phase 3 has run)
   - Strong textual overlap (proper nouns, repeated concepts)
   - Same folder, but NOT identical subfolder (favor cross-section peers)
3. **Cross-venture preference**: if the note is in `_thinking/` or `finsov/`, at least one of the 2-4 links should point to a different top-level folder
4. **Avoid trivial links**: don't suggest the note's own `context.md` unless the note is itself outside the venture; don't suggest archived notes
5. Append exactly this block to the end of the body (with a blank line before):

```markdown

## See also
- [[Peer Note Title]]
- [[Other Peer]]
- [[Cross-venture/Adjacent Note]]
```

Skip and log if:
- The note already has a `## See also` block (even empty)
- The note is shorter than 80 characters of body content (it's a stub)
- You cannot find 2 confident peers

Write a `connectivity-retrofit.log` entry for each processed note: `[phase1] path | added: N links | skipped: reason`

**Stop here. Print the count of notes updated and skipped. Wait for me to say "continue with phase 2".**

---

## Phase 2 — `## Adjacent work` on hub notes

For every file matching `**/context.md`, `**/MOC.md`, `**/index.md`, `**/Home.md` that does **not** already contain `## Adjacent work`:

1. Read the file in full
2. Identify 2-5 *outward-pointing* wikilinks following these rules:
   - At least one MUST point to a sibling hub (e.g. `finsov/context.md` linking to `smo/context.md`)
   - At least one MUST point to a re-usable playbook or pattern note used in this hub's venture
   - Prefer notes that themselves have high in-link count (likely-important nodes)
3. Append:

```markdown

## Adjacent work
- [[other-venture/context]] — one-line reason
- [[playbook or pattern note]] — one-line reason
- [[cross-cutting reference]] — one-line reason
```

The one-line reasons are required — they should be concrete (≤12 words each) and explain the *why* of the link.

Log each: `[phase2] path | added: N adjacent | reasons: brief summary`

**Stop. Wait for "continue with phase 3".**

---

## Phase 3 — Multi-value semantic tags in frontmatter

For every note that has any frontmatter but **lacks** all three of `topics:`, `concepts:`, `mentions:`:

1. Read the full note (title, frontmatter, body)
2. Generate exactly these three frontmatter fields, inserting them after the existing classifier fields (`venture`, `status`, `type`, `tier`) and before any other fields:

```yaml
topics: [3-5 kebab-case subject-matter tags]
concepts: [1-3 kebab-case abstract patterns the note exemplifies]
mentions: [0-5 kebab-case proper nouns — people, products, companies, services]
```

Rules:
- Tag values must be lowercase, kebab-case (no spaces, no slashes, no `#`)
- `topics:` is what the note is *about* in the world — pricing, customer-acquisition, dns-config, etc
- `concepts:` is recurring abstract patterns — revenue-model, escalation-handling, defensive-naming, etc
- `mentions:` is proper nouns only — `carly-stipancic`, `schwab`, `linear-app`, never `client` or `bank`
- If a note has no proper nouns, set `mentions: []`
- Reuse existing tag values when possible — check the vault's overall tag vocabulary first and consolidate near-duplicates (`b2b` vs `b2b-sales` → pick one)
- Do not modify any other frontmatter field

Skip and log if:
- The note has all three fields already
- The note body is shorter than 200 characters
- You cannot generate at least 2 `topics:` values confidently

Log: `[phase3] path | topics: N, concepts: M, mentions: K`

---

## Final summary

After all three phases, write `connectivity-retrofit.summary.md` at the vault root containing:

- Total notes processed per phase
- Total notes skipped per phase, grouped by reason
- Top 30 most-used new tag values across `topics:`/`concepts:`/`mentions:`
- 5 candidate notes flagged as orphans (no `## See also`, no relations frontmatter, no inbound wikilinks)
- 5 candidate notes flagged as over-linked (>15 outgoing wikilinks after retrofit)

---

## Safety checklist before you start

- Confirm you are in the vault root (`pwd` should match the vault directory)
- Confirm `git status` shows a clean working tree (so changes are reviewable)
- Confirm `git rev-parse --abbrev-ref HEAD` is on a working branch, not `main`
- Create the branch `connectivity-retrofit` if not already on it: `git checkout -b connectivity-retrofit`

Ask me to confirm before starting Phase 1.
