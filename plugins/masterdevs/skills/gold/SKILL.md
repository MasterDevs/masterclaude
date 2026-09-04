---
name: gold
description: "Capture a curated example of good code, a good abstraction, or a good design into the Playbook's gold lane — the third lane beside pattern catalogs and reviewer lessons. This skill is the ONLY writer of that lane: agents read entries and cite their ids, and no workflow step ever stages one. Six questions, each with a recommended answer you accept with 'y'; everything else is derived from the repo. Invoke as /masterdevs:gold."
---

# /masterdevs:gold — capture one example worth copying

Pattern catalogs say what shape to reach for. Lessons say what trap to avoid. Neither shows an agent a
piece of code a human actually liked. That is what this captures — one entry, one example, live the
moment it is written.

## Step 0 — Resolve paths (do this first)

- `PLUGIN_ROOT` = `${CLAUDE_PLUGIN_ROOT}` (this plugin's cache dir — read-only seeds; wiped on update).
- `DATA_DIR` = `${CLAUDE_PLUGIN_DATA}` if it resolves to a real absolute path; **otherwise fall back**
  to `~/.claude/plugins/data/masterdevs-masterclaude/` (the `<plugin>-<marketplace>` id; create it).
  All mutable state lives here — never write learned data under `PLUGIN_ROOT`.
- `PLAYBOOK_DIR` = `$DATA_DIR/playbook`
- `REPO_ROOT` = `git rev-parse --show-toplevel`

Then read `${CLAUDE_PLUGIN_ROOT}/references/gold-schema.json` and **render the entry template from it** —
the frontmatter field list, the three section templates, and the excerpt line budget all come from that
file at capture time.

> **Never transcribe the field list or the section headings into this file.** The schema is
> authoritative and the validator reads the same file. A prose copy here would drift, and the first
> thing you would notice is capture writing entries `gold.mjs --validate` rejects.

## The question budget — six, and not a seventh

Exactly **six** questions may be asked. Every other frontmatter field is **derived**, never asked:

| Field | Derived from |
|---|---|
| `id` | kebab-case of the title |
| `language` | the anchor file's extension |
| `lenses` | the domain plus what the example demonstrates |
| `scope`, `source` | the audience answer (question 1) |
| each anchor's `sha` | `git log -1 --format=%H -- <path>` |
| `provenance` | who captured it and when |
| the excerpt itself | read out of the anchor file |

If a field feels like it needs asking, derive it and show the derived value in the final confirmation
instead. The protocol is the house one — `${CLAUDE_PLUGIN_ROOT}/references/interview.md` — one question
at a time with your guess attached.

Every question prints one explicitly marked recommendation the user accepts with a bare `y`. The six
headings below carry that shape already — ask each one exactly as written, with the placeholders filled
in from the repo. No question may be asked without a recommendation attached: an unanswerable question
is what turns a two-minute capture into an interview.

## The six questions

### 1. Audience — who is this entry for? `[recommend: <local|team>]` — y to accept, or type an override

Decide the recommendation by **three ordered checks, first match wins**, and print which one fired so
there is no hidden judgment call:

1. `git remote -v` prints nothing, **or** `git shortlog -sn HEAD | wc -l` is `1` → recommend **local**.
   (Nobody else is reading this repo, so a team lane would have an audience of one.)
2. The excerpt references identifiers defined in this repo — a module, type, or function name
   `git grep` finds only here → recommend **team**. It only reads correctly next to this code.
3. Otherwise → recommend **local**, plus one line noting it looks worth sharing beyond this machine
   and can be submitted later with `/masterdevs:contribute`.

There are exactly **two** capture targets:

| Answer | File | Frontmatter |
|---|---|---|
| local | `$PLAYBOOK_DIR/gold/<id>.md` | `scope: local`, `source: local` |
| team | `$REPO_ROOT/.masterdevs/gold/<id>.md` | `scope: repo`, `source: repo` |

`$REPO_ROOT/.masterdevs/` is the same per-repo convention as `.masterdevs/preflight.json`. Entry files
are **flat** in the lane directory — no domain subdirectory; the domain lives in frontmatter and the
generated index groups by it.

Capture **never** targets `playbook-seeds/gold` or upstream. Those are reached only by a maintainer's
own checkout and by `/masterdevs:contribute` respectively.

### 2. Kind and domain `[recommend: <kind> / <domain>]` — y to accept, or type an override

One paired recommendation, not two questions. Read the kinds from the schema and pick by what the
example *is*: a single well-shaped piece of code, a contract other things conform to, or a structure
whose seams are the point. Domain is one of the pattern-catalog domains under
`$PLAYBOOK_DIR/patterns/` (`core`, `backend`, `frontend`, `data`, `algo`, `concurrency`, `integration`,
`testing`, `infra`).

### 3. The anchors `[recommend: <file>#<symbol>, …]` — y to accept, or type an override

Confirm the set as a list of `(file, symbol)` pairs. Rules:

- **Prefer a symbol over a line range.** A symbol is what `--validate` can check for rot; a range only
  proves the file is still long enough. When a range is unavoidable, write it as `L<start>-L<end>`.
- Take each `sha` from `git log -1 --format=%H -- <path>` — the commit that last touched that file, so
  the sha means *this excerpt as of here*.
- **Refuse if the file is untracked or has uncommitted changes**, and ask the user to commit first. An
  anchor with no verifiable sha cannot be checked for rot, and an entry that can never be found stale
  is worse than no entry.

### 4. Title `[recommend: <title>]` — y to accept, or type an override

A short noun phrase a cold reader can pick out of an index. `id` is its kebab-case form.

### 5. `not-this` — the near-miss this entry is *not* `[recommend: <the tempting wrong version>]` — y to accept, or type an override

The shape someone would reach for instead, and why it is worse. Answer `none` if there genuinely is no
near-miss; the field stays present either way.

### 6. Which catalog patterns does this demonstrate? `[recommend: <pattern>, …]` — y to accept, or type an override

Propose by matching the example against `$PLAYBOOK_DIR/patterns/<domain>/catalog.md` and
`patterns/core/catalog.md`. `patterns[]` may be empty — an example need not name a pattern.

If nothing matches, offer **inside this same question** (not a seventh) to add a human-confirmed pattern
straight into that domain's `catalog.md` through `/masterdevs:playbook`'s existing direct-add mode
(mode 2). Do it **only** on an explicit yes; the human-confirmation rule still holds.

Never edit a catalog to point back at a gold entry. The reference runs **gold → pattern only**, so a
catalog row stays readable on its own and cannot rot when an entry is retired.

## Write the entry

Body is `## Shows` (one or two sentences: what a reader should take from this) followed by the kind's
sections from the schema, in the schema's order.

**Snapshot the excerpt into the body** so a reader needs no access to the repo it came from. Honor the
schema's `excerptLineBudget` for the kind — roughly 60 lines for code and abstraction, longer for
design so several seams can be quoted. Fence each excerpt and label it with its anchor's path and
symbol.

Then finish deterministically, in this order:

1. Write the single entry file at the chosen target.
2. Reindex **the lane you just wrote**, and pass `--playbook-dir` every time:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --reindex --scope <local|repo> --playbook-dir "$PLAYBOOK_DIR"
   ```

3. Validate **the same lane**, by pointing at it directly:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --validate --gold-dir "<the lane you wrote>"
   ```

`--playbook-dir` is not optional here. Without it the script falls back to the default data directory,
so on any machine whose Playbook lives somewhere else the reindex writes one lane while the validation
reads another — and capture reports success over an entry nobody checked. Naming the lane in step 3
closes the same hole from the other side: it validates what you wrote, not whatever the scope chain
happens to resolve to.

If validation reports anything, **fix the entry and re-run before reporting success.** The validator is
authoritative — that is the mechanism that stops this prose template drifting from the schema, and it is
the reason none of the schema is restated here.

Report in one line: the id, the scope it landed in, and the anchors it carries.

## Rules

- **This skill is the only writer of the gold lane.** No agent, no reviewer, and no workflow step may
  write, stage, or reindex it. Agents read entry files a plan step names and cite ids.
- **A captured entry is live immediately.** There is no candidate stage and no recurrence gate, unlike
  patterns and lessons — a human chose this example, which *is* the gate.
- **Never write anything under `${CLAUDE_PLUGIN_ROOT}`.** It is wiped on plugin update.
- **Show the user the full entry body before writing it.** A captured entry becomes content every future
  agent reads, so capture is a write into the agents' standing context — the same class of action
  `/masterdevs:playbook` treats as security-relevant.
- **Refuse to capture an excerpt containing a credential, token, private key, or key-shaped string.**
  Say what you found and ask for a different excerpt; do not redact and proceed.
- A **team-scope** entry is committed to the repo, so real internal names in it are intentional and stay.
  Scrubbing happens only at submission time, in `/masterdevs:contribute`.
