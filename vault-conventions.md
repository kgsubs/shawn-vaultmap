# Vault Connectivity Conventions

These conventions exist so the vault behaves like a connected graph, not a pile of islands. Average node degree should sit around 4-6 — currently it's ~1.5. The lift comes from three small, mechanical patterns applied consistently.

Add these guidelines verbatim to `CLAUDE.md` (or merge into the existing "Linking" / "Note structure" sections).

---

## 1. Every note ends with a `## See also` block

Two to four wikilinks to the closest related notes anywhere in the vault. These are *neighbors*, not children. Cross-venture links are encouraged — that's where the graph gets its connective tissue.

```markdown
## See also
- [[active/schwab setup]]
- [[client reassurance playbook]]
- [[2026-05-21 - Post-Schwab Email to Carly]]
```

Rules:
- Use the closest unambiguous form. Path-prefixed (`folder/note`) is fine and preferred when the basename is reused.
- 2-4 entries. Less than 2, the note is an orphan. More than 4, the relationship is dilute.
- Never link to a note's own children-by-folder. Pick *peers* across folders.

## 2. Hub notes (every `context.md`) end with `## Adjacent work`

Hubs already enumerate their own venture. The job of `## Adjacent work` is to point *outward* — to peer hubs, key cross-venture notes, or reusable playbooks living in other ventures.

```markdown
## Adjacent work
- [[smo / context]] — pricing-tier overlap with SMO clients
- [[tight99 / context]] — financial discipline lessons applied to client portfolios
- [[client reassurance playbook]] — shared pattern across all FINSOV clients
```

Rules:
- 2-5 entries per hub.
- At least one must point to a *different venture* or top-level folder.
- Replace as relevance shifts; treat this section as living.

## 3. Frontmatter relations carry typed edges

When the relationship has structure (parent, prerequisite, supersedes, references), put it in frontmatter rather than the body. Both forms create graph edges; frontmatter is where the *typed* ones live.

```yaml
---
venture: finsov
status: active
type: playbook
topics: [client-reassurance, escalation, exit-talk]
up: "[[finsov context]]"
related:
  - "[[seed phrase backup methodology]]"
  - "[[2026-05-16 - Carly Call 1]]"
references:
  - "[[carly-stipancic/context]]"
---
```

Recognized relation fields (each treated as an outgoing edge):
- `up`, `parent`, `parents`, `index` — points to a hub
- `related`, `relates-to`, `links`, `linked`, `see-also`
- `references`, `refs`
- `children`, `child`
- `connects`, `connections`
- `prev`, `next`

Values can be: bare titles, `[[wikilinks]]`, or `folder/path`. Quotes recommended when using `[[...]]` inside YAML.

## 4. Multi-value semantic tags

Existing single-value classifiers (`venture`, `status`, `type`, `tier`) stay. Add **conceptual** tags that describe what a note is *about*, not what it *is*:

```yaml
topics: [pricing, ideation, b2b-sales, mvp-scope]
concepts: [revenue-model, customer-acquisition]
mentions: [carly-stipancic, schwab, citi]
```

Tag namespace conventions:
- `topics:` — subject-matter (lowercase, kebab-case)
- `concepts:` — recurring abstract patterns
- `mentions:` — proper nouns (people, products, companies); kebab-case
- 3-8 values total across these three fields per note

## 5. `_thinking/` daily notes always cite at least one wikilink

The biggest source of orphans is dated capture notes that don't tie to anything. Require a tail-line:

```markdown
## tied to
- [[finsov context]]
- [[2026-05-22 - Solo Business Ideation]]
```

Even one wikilink kills the orphan. Two-to-three is the target.

---

## Why this matters

Without these, the graph layout collapses into per-folder mandalas because the only force pulling notes around is the cluster anchor. With them:

- Avg degree rises from ~1.5 to ~5
- Cross-cluster ratio rises from <5% to ~25%
- Concept-tag clustering becomes meaningful (right now `#status/active` is the dominant tag, which is useless visually)
- Search by concept actually surfaces *concepts* rather than note-types

## Migration

A one-shot pass over the existing vault with Claude Code is the fastest way to retrofit. See `claude-code-prompt.md` in this project for a prompt that adds these blocks across existing notes safely.
