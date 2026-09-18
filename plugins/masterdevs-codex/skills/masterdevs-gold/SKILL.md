---
name: masterdevs-gold
description: "Capture a curated example of good code, a good abstraction, or a good design into the Playbook's gold lane — the third lane beside pattern catalogs and reviewer lessons — and send it wherever it belongs: the public plugin repo as a pull request, your team's repository, or just this machine. This skill is the ONLY writer of that lane: agents read entries and cite their ids, and no workflow step ever stages one. Six questions, the first being where it goes, each with a recommended answer you accept with 'y'; everything else is derived from the repo. Invoke as $masterdevs-gold."
---

# $masterdevs-gold — capture one example worth copying, and send it where it belongs

Pattern catalogs say what shape to reach for. Lessons say what trap to avoid. Neither shows an agent a
piece of code a human actually liked. That is what this captures — one entry, one example, live the
moment it is written.

Capture and contribution are **one command**, because they are one decision. Whether an example is
worth sharing is the thing a person knows at the moment they capture it, and asking it later means
asking it never. So the first question is where it goes, and the answer routes everything after it.

## Step 0 — Resolve paths (do this first)

- `PLUGIN_ROOT` = two directories above this skill (this plugin's cache dir — read-only seeds; wiped
  on reinstall).
- Everything else comes from one call, rather than being assembled by hand:

  ```
  node "$PLUGIN_ROOT/scripts/codex-state.mjs" paths --json
  ```

  Take `playbookDir` as `PLAYBOOK_DIR` and `repoRoot` as `REPO_ROOT`. All mutable state lives under the
  returned `dataDir` — never write learned data under `PLUGIN_ROOT`.

> **Do not hardcode a data directory here.** Codex defaults it to a repository-keyed directory under
> the system temp root so it stays inside the normal sandbox, and a user may repoint it with
> `MASTERDEVS_DATA_DIR`. A literal path in this file would capture entries into a lane no agent reads.

Then read `$PLUGIN_ROOT/references/gold-schema.json` and **render the entry template from it** —
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
instead. The protocol is the house one — `$PLUGIN_ROOT/references/interview.md` — one question
at a time with your guess attached.

Every question prints one explicitly marked recommendation the user accepts with a bare `y`, **and one
line saying what the answer decides**. The six headings below carry that shape already — ask each one
exactly as written, with the placeholders filled in from the repo. The `SO:` line is the protocol's
(`references/interview.md`) and is not optional here: a recommendation the user cannot weigh is a coin
flip they are being asked to call, and six of those turn a two-minute capture into an interview they
cannot answer.

None of these six may be named after a field whose meaning comes from the schema. The user does not know
what `not-this` or an anchor is, and does not need to — they know their own code. A field whose name is
also an ordinary English word is fine: question 4 is called **Title** because that is what a person would
call it, not because `title` is a frontmatter key.

## The six questions

### 1. Destination — where does this go? `[recommend: <public|team|local>]` — y to accept, or type an override

Ask this **first**, before anything else is settled.

> **SO:** this decides who can ever read the example. **local** keeps it on this machine. **team**
> commits it beside your code, where real internal names are fine. **public** opens a pull request, so
> the copy that leaves gets scrubbed first and a maintainer decides whether it ships. You keep your own
> copy either way, and the choice can be revisited later without capturing anything twice.

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
an ambiguous id with `node $PLUGIN_ROOT/scripts/gold.mjs --list`.

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
  `$PLUGIN_ROOT/references/upstream-submit.md` from step 2 onward and do not restate it here.

That reference carries its own approval gates — the tracker-id question, the full scrubbed diff, and the
confirmed upstream target. **Those are not part of the six-question budget.** Pushing to a public
repository is an outward-facing, hard-to-reverse action, so it is gated separately and on purpose.

### 2. What is this an example of, and what work does it belong to? `[recommend: <kind> / <domain>]` — y to accept, or type an override

> **SO:** the kind picks which sections the entry is written in — a well-shaped piece of code, a
> contract, and a structure each need different things said about them. The domain decides which
> catalog the example is filed beside, and so which future work surfaces it.

One paired recommendation, not two questions. Read the kinds from the schema and pick by what the
example *is*: a single well-shaped piece of code, a contract other things conform to, or a structure
whose seams are the point. Domain is one of the pattern-catalog domains under
`$PLAYBOOK_DIR/patterns/` (`core`, `backend`, `frontend`, `data`, `algo`, `concurrency`, `integration`,
`testing`, `infra`).

### 3. Which code should this example point at? `[recommend: <file> · <symbol>, …]` — y to accept, or type an override

Ask for a file and the function or class inside it — never the word "anchor". Say what the answer buys:

> **SO:** the entry keeps a copy of that code, plus a note of where it came from and the commit it was
> current at. That note is what lets `--validate` tell you later that the original was renamed or
> removed and the saved copy has gone out of date.

Confirm the set as a list of `(file, symbol)` pairs. Rules:

- **Prefer a symbol over a line range**, and tell the user why when you recommend one: a function or
  class name survives edits above it, so a rename is caught. A line range only proves the file is still
  long enough, so a rename passes silently. When a range is unavoidable, write it as `L<start>-L<end>`.
- Take each `sha` from `git log -1 --format=%H -- <path>` — the commit that last touched that file, so
  the sha means *this excerpt as of here*.
- **Refuse if the file is untracked or has uncommitted changes**, and ask the user to commit first —
  saying why, not just refusing: without a commit to point at there is nothing to compare against later,
  so the entry could never be found stale, which is worse than not capturing it.
- If the example spans more than one place, name them all. Each gets its own excerpt in the body.

### 4. Title `[recommend: <title>]` — y to accept, or type an override

A short noun phrase a cold reader can pick out of an index. `id` is its kebab-case form.

> **SO:** this is the line an agent sees in the index before deciding whether to open the entry, and the
> id is permanent — renaming later means a second entry for one example.

### 5. What would someone reach for instead, that this example is deliberately not? `[recommend: <the tempting wrong version>]` — y to accept, or type an override

The shape a reasonable person would write instead, and why it is worse.

> **SO:** the entry shows that wrong version beside the right one, so a reader learns the distinction
> rather than only the conclusion. Answer `none` and they see the right version alone — which is the
> better answer when there is no tempting alternative, and a loss when there is.

Answer `none` if there genuinely is no near-miss; the field stays present either way.

### 6. Which catalog patterns does this demonstrate? `[recommend: <pattern>, …]` — y to accept, or type an override

> **SO:** naming a pattern is how an agent looking for that pattern finds this example. Name none and
> the example is still readable and still found by domain — it just will not surface for a pattern
> search.

Propose by matching the example against `$PLAYBOOK_DIR/patterns/<domain>/catalog.md` and
`patterns/core/catalog.md`. `patterns[]` may be empty — an example need not name a pattern.

If nothing matches, offer **inside this same question** (not a seventh) to add a human-confirmed pattern
straight into that domain's `catalog.md` through `$masterdevs-playbook`'s existing direct-add mode
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
2. Reindex **the lane you just wrote — that one lane and no other.** Which flag pins it depends on
   which lane it is, so run exactly one of these, never both:

   If you wrote the local lane (**local**, and the kept copy on the **public** path):

   ```
   node $PLUGIN_ROOT/scripts/gold.mjs --reindex --scope local --playbook-dir "$PLAYBOOK_DIR"
   ```

   If you wrote the repository's lane (**team**):

   ```
   node $PLUGIN_ROOT/scripts/gold.mjs --reindex --scope repo --repo-root "$REPO_ROOT"
   ```

   Reindexing the repo lane **creates it if it is absent**, so running the second command after a local
   capture leaves an empty `.masterdevs/gold/INDEX.md` in the user's checkout — an untracked directory
   they then have to notice and delete. One lane was written; reindex that one.

3. Validate **the same lane**, and pass `--repo-root` as well:

   ```
   node $PLUGIN_ROOT/scripts/gold.mjs --validate --gold-dir "<the lane you wrote>" --repo-root "$REPO_ROOT"
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

**Print a bounded preview — never the whole entry.** The user just answered six questions about it and
the excerpt is their own code, so reprinting several hundred lines they already know buries the one
thing they need, which is where it went. Show enough to confirm the right thing was captured, and stop.

**Hard cap: 10 lines — every line capture prints at the end, this block included.** Use this shape:

```
  <absolute path to the entry file>
  <id> · <kind>/<domain> · from <n> place(s): <file>·<symbol>, …
  Shows — <the ## Shows sentence, one line, truncated to fit>
  ┌ <first line of the first excerpt>
  │ <second line>
  │ <third line>
  └ … +<n> more lines · say `show` for the whole entry
```

Put the path on its own line, first, so the terminal makes it clickable. That shape is seven lines,
which leaves three. Spend them on more excerpt lines, or — on the **public**
path — on the pull request line, which counts against the ten like everything else. When something must
give, drop excerpt lines first: the path, the id line and `Shows` are the three that carry the
confirmation. Truncate long lines rather than wrapping them, since a wrapped line costs two of the ten.

Offer `show` and honor it; never volunteer the body. On the **public** path, add the pull request URL —
and say plainly that a maintainer's review, not this command, decides whether it ships.

## Rules

- **This skill is the only writer of the gold lane.** No agent, no reviewer, and no workflow step may
  write, stage, or reindex it. Agents read entry files a plan step names and cite ids.
- **A captured entry is live immediately.** There is no candidate stage and no recurrence gate, unlike
  patterns and lessons — a human chose this example, which *is* the gate.
- **Never write anything under `$PLUGIN_ROOT`.** It is wiped on plugin update.
- **Preview the entry in ten lines or fewer; never dump the body** — report the path and let the user
  open it if they want more. Be accurate about what that trades away: the preview shows `Shows` and the
  first excerpt lines, so the prose *you* wrote — `not-this`, the kind's sections — goes unread unless
  the user asks. The excerpt is their own code and the local lane never leaves the machine, so on the
  **local** path that is a fair trade.
- **On the `team` path, say what they are about to commit.** That lane is committed to a shared
  repository, keeps internal names verbatim by design, and that repository may be public. End the
  preview's last line with `show` before you commit it rather than the plain offer, so the one review
  before it reaches other people is not skipped by default.
- **The gate that guards people outside the team is the full scrubbed diff** in
  `references/upstream-submit.md`, before any push. It is unchanged by any of the above and is not
  optional. 
- **Refuse to capture an excerpt containing a credential, token, private key, or key-shaped string.**
  Say what you found and ask for a different excerpt; do not redact and proceed. This is the one content
  check that runs at capture time, because it protects the user from their own repository rather than
  protecting anyone else from the user.
- A **team-scope** entry is committed to the repo, so real internal names in it are intentional and
  stay. Scrubbing happens only on the **public** path, on a copy, per
  `$PLUGIN_ROOT/references/upstream-submit.md`.
- **The public path never operates in the user's checkout.** It clones, branches, pushes and deletes.
  That reference owns the rule; do not reimplement any of it here.
