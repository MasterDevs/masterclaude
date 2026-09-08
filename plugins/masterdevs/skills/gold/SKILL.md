---
name: gold
description: "Capture a curated example of good code, a good abstraction, or a good design into the Playbook's gold lane — the third lane beside pattern catalogs and reviewer lessons — and send it wherever it belongs: the public plugin repo as a pull request, your team's repository, or just this machine. This skill is the ONLY writer of that lane: agents read entries and cite their ids, and no workflow step ever stages one. Six questions, the first being where it goes, each with a recommended answer you accept with 'y'; everything else is derived from the repo. Invoke as /masterdevs:gold."
---

# /masterdevs:gold — capture one example worth copying, and send it where it belongs

Pattern catalogs say what shape to reach for. Lessons say what trap to avoid. Neither shows an agent a
piece of code a human actually liked. That is what this captures — one entry, one example, live the
moment it is written.

Capture and contribution are **one command**, because they are one decision. Whether an example is
worth sharing is the thing a person knows at the moment they capture it, and asking it later means
asking it never. So the first question is where it goes, and the answer routes everything after it.

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
| `scope`, `source` | the destination answer (question 1) |
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

### 1. Destination — where does this go? `[recommend: <public|team|local>]` — y to accept, or type an override

Ask this **first**, before anything else is settled. It decides the frontmatter, whether the excerpt
gets scrubbed, and whether the flow ends on this machine or in a pull request.

| Answer | Where it lands | Frontmatter | Reviewed by |
|---|---|---|---|
| **public** | this machine's lane, **and** a pull request to the plugin repo | the kept copy `scope: local`, `source: local`; the submitted copy `scope: seeds`, `source: contributed` | a maintainer, on GitHub |
| **team** | `$REPO_ROOT/.masterdevs/gold/<id>.md` | `scope: repo`, `source: repo` | your repository's own review |
| **local** | `$PLAYBOOK_DIR/gold/<id>.md` | `scope: local`, `source: local` | nobody — it is yours |

Decide the recommendation by **three ordered checks, first match wins**, and print which one fired so
there is no hidden judgment call:

1. The excerpt references identifiers `git grep` finds **only in this repo** — a module, type, or
   function defined here → recommend **team**. It only reads correctly next to this code, and it cannot
   be genericized into anything a stranger could learn from.
2. The excerpt is **self-contained**: every identifier it uses is a language builtin, a public library,
   or defined inside the excerpt itself → recommend **public**. It would teach any user of this plugin,
   which is the only reason the public lane exists.
3. Otherwise → recommend **local**, plus one line saying the destination can be revisited later without
   re-capturing anything (see below).

**One downgrade, applied after the checks.** If the recommendation came out **team** but `git remote -v`
prints nothing, or `git shortlog -sn HEAD | wc -l` is `1`, recommend **local** instead and say why: a
team lane in a repository nobody else reads has an audience of one.

Capture **never** writes `playbook-seeds/gold` directly. The shipped lane is reached only by a
maintainer merging a pull request — which is what **public** opens.

#### An entry that already exists — ask question 1 and nothing else

When the subject is an entry already in a lane — the user names an id, or says "send that one upstream"
— there is nothing to capture. **Ask the destination question and skip questions 2 through 6.** Resolve
an ambiguous id with `node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --list`.

Moving an entry is a copy plus a frontmatter change, never a re-capture: a second entry describing the
same example under a new id is a duplicate the resolver will keep forever.

| From → to | What to do |
|---|---|
| local → team | Copy to `$REPO_ROOT/.masterdevs/gold/<id>.md`, set `scope: repo` and `source: repo`, then `--reindex --scope repo --repo-root "$REPO_ROOT"` and `--validate --gold-dir "$REPO_ROOT/.masterdevs/gold" --repo-root "$REPO_ROOT"`. Both flags matter for the reasons the write step below gives. Then tell the user to commit it. |
| local or team → public | Leave the entry where it is and submit a scrubbed **copy**, exactly as the public answer below does. |
| team → local | Copy to `$PLAYBOOK_DIR/gold/<id>.md`, set `scope: local` and `source: local`, then `--reindex --scope local --playbook-dir "$PLAYBOOK_DIR"` and `--validate --gold-dir "$PLAYBOOK_DIR/gold" --repo-root "$REPO_ROOT"`. Spelled out rather than "same flags" — the lane changed, so both paths change with it. Warn that internal names captured for team scope are now on a lane shared with every repository this machine visits. |

This is why capture and contribution are one command rather than two: the second command existed only
to answer a question this one already asks.

#### What each answer does after the entry is written

- **local** — done. Report and stop.
- **team** — the entry is already in the repository's lane; tell the user to commit it with their own
  code. **Real internal names stay verbatim**, which is the entire point of team scope. Nothing is
  scrubbed, because nothing is leaving.
- **public** — the entry is written to **this machine's lane first**, so the user keeps their own copy,
  and then a scrubbed **copy** is submitted. Follow
  `${CLAUDE_PLUGIN_ROOT}/references/upstream-submit.md` from step 2 onward and do not restate it here.

That reference carries its own approval gates — the tracker-id question, the full scrubbed diff, and the
confirmed upstream target. **Those are not part of the six-question budget.** Pushing to a public
repository is an outward-facing, hard-to-reverse action, so it is gated separately and on purpose.

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

1. Write the single entry file at the destination question's target — for **public**, that is this
   machine's local lane.
2. Reindex **the lane you just wrote**, naming that lane's own root — a different flag per lane:

   ```
   # local lane
   node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --reindex --scope local --playbook-dir "$PLAYBOOK_DIR"
   # repo lane
   node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --reindex --scope repo --repo-root "$REPO_ROOT"
   ```

3. Validate **the same lane**, and pass `--repo-root` as well:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --validate --gold-dir "<the lane you wrote>" --repo-root "$REPO_ROOT"
   ```

**Each flag pins a different thing, and the wrong one is silently inert.** `--playbook-dir` locates the
local lane and has no bearing on the repo lane; `--repo-root` locates the repo lane and is ignored for
the local one. Pass neither and the script falls back to the default data directory, so on any machine
whose Playbook lives elsewhere the reindex writes one lane while the validation reads another.

`--repo-root` on step 3 is what makes the validation mean anything. Naming a lane with `--gold-dir`
deliberately stops the script guessing which repository to judge the anchors against — so without
`--repo-root` every anchor is reported as belonging to some other repository, skipped, and the command
exits `0`. A deleted anchor file passes. That is the same "success over an entry nobody checked" the
lane flag exists to prevent, reached from the opposite side.

If validation reports anything, **fix the entry and re-run before reporting success.** The validator is
authoritative — that is the mechanism that stops this prose template drifting from the schema, and it is
the reason none of the schema is restated here.

Report in one line: the id, the lane it landed in, and the anchors it carries. On the **public** path,
add the pull request URL — and say plainly that a maintainer's review, not this command, decides whether
it ships.

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
- A **team-scope** entry is committed to the repo, so real internal names in it are intentional and
  stay. Scrubbing happens only on the **public** path, on a copy, per
  `${CLAUDE_PLUGIN_ROOT}/references/upstream-submit.md`.
- **The public path never operates in the user's checkout.** It clones, branches, pushes and deletes.
  That reference owns the rule; do not reimplement any of it here.
