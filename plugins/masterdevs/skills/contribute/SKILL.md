---
name: contribute
description: "Submit a gold entry, a learned pattern, or a learned lesson from your local Playbook upstream to MasterDevs/masterclaude as a pull request — or promote a local gold entry to your own repository's team scope with --to repo. Reaches upstream only through a throwaway clone, so no checkout you work in is ever touched, and scrubs internal names and paths on the upstream path only. Invoke as /masterdevs:contribute."
---

# /masterdevs:contribute — send one thing off this machine

The Playbook learns locally. This is the only path out: either **up** to the shipped seeds as a pull
request a maintainer reviews, or **across** from your own machine to your team's repository.

Nothing here promotes anything. Upstream, review on GitHub is the gate; at team scope, your repository's
own review is.

## Step 0 — Resolve paths (do this first)

- `PLUGIN_ROOT` = `${CLAUDE_PLUGIN_ROOT}` (this plugin's cache dir — read-only; wiped on update).
- `DATA_DIR` = `${CLAUDE_PLUGIN_DATA}` if it resolves to a real absolute path; **otherwise fall back**
  to `~/.claude/plugins/data/masterdevs-masterclaude/`. All mutable state lives here — never write under
  `PLUGIN_ROOT`.
- `PLAYBOOK_DIR` = `$DATA_DIR/playbook`
- `REPO_ROOT` = `git rev-parse --show-toplevel`

## Arguments

| Argument | Meaning |
|---|---|
| `--to upstream` | **Default.** Submit to the shipped seeds as a pull request. |
| `--to repo` | Promote a local gold entry into this repository's team scope. |
| `--gold <id>` | The subject is the gold entry with that id. |
| `--pattern <name>` | The subject is a promoted pattern row. |
| `--lesson <name>` | The subject is a promoted lesson entry. |
| `--upstream <owner/repo>` | Where a pull request goes. Defaults to `MasterDevs/masterclaude`. |

`--upstream` accepts a fork or a disposable remote, which is how the whole flow gets exercised without
opening a real pull request — say which target you resolved and confirm it back before any push.

## The procedure — one ordered path, `--to repo` returns early

### 1. Resolve the subject

- `--gold <id>` → read `$PLAYBOOK_DIR/gold/<id>.md`. Resolve through
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --list` if the id is ambiguous.
- `--pattern <name>` → the row in `$PLAYBOOK_DIR/patterns/<domain>/catalog.md`.
- `--lesson <name>` → the entry in `$PLAYBOOK_DIR/lessons/<lens>.md`.

A pattern or lesson must **already be promoted**. A candidate is not eligible: it has not passed the
gate, and `/masterdevs:playbook` is where that happens.

### 2. `--to repo` only — copy across, then STOP

Copy `$PLAYBOOK_DIR/gold/<id>.md` to `$REPO_ROOT/.masterdevs/gold/<id>.md`, set `scope: repo` and
`source: repo` in its frontmatter, then:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --reindex --scope repo
node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --validate --gold-dir "$REPO_ROOT/.masterdevs/gold"
```

Name the lane in the validate call. Left to the scope chain it would validate everything resolvable
from here, so a pre-existing problem in another lane reads as a failure of the entry you just promoted.

**Stop there.** No scrub, no clone, no pull request.

**Team-scope entries keep real internal identifiers verbatim** — module names, type names, service names,
paths. That is the *point* of team scope: the example only reads correctly next to the code it came from.
It is why scrubbing lives solely on the upstream branch of this procedure.

Report the file it landed in and remind the user to commit it with their own code.

### 3. Upstream only — scrub a copy

Scrubbing operates on a **copy**, never on the source entry in `$PLAYBOOK_DIR`. Your own lane is yours;
a submission is a derived artifact. Stage the copies somewhere disposable and keep a list of exactly
what is being submitted — the gate in step 4 needs that list, and step 6 copies from it into the clone:

```
WORK="$(mktemp -d)"
mkdir -p "$WORK/submit"
cp "$PLAYBOOK_DIR/gold/<id>.md" "$WORK/submit/<id>.md"       # or the pattern/lesson file
ls "$WORK"/submit/* > "$WORK/submit.txt"                      # one absolute path per line
```

Build the active pattern list the same way, from two sources in this order:

1. `${CLAUDE_PLUGIN_ROOT}/references/scrub-patterns.txt` — the shipped shape classes.
2. `$PLAYBOOK_DIR/scrub-patterns.local.txt` — your own organisation, repository and module names, if the
   file exists. Those cannot ship in a public repo, so the local file is where they live.

**Tracker ids are not in the shipped list**, and cannot be — no regex separates `PROJ-1234` from
`SHA-256`. So if the local file carries no tracker pattern, ask before going any further:

> No tracker-id pattern is configured, so `ENG-1234`-style references will not be scrubbed
> automatically. I read the entry and found none. **Recommend: proceed (y)** — or say the prefixes you
> use and I will add them to `scrub-patterns.local.txt` first.

Read the entry yourself before asking, and say what you actually found. Asking in the abstract puts the
work back on the user, which is how a question becomes a rubber stamp.

Both files are commented, and a comment line is not a regex, so strip comments and blanks once and use
the result for **both** jobs — the rewrite and the gate — so the two cannot disagree about what counts:

```
PATTERNS="$WORK/scrub-patterns.active.txt"
: > "$PATTERNS"
for f in "${CLAUDE_PLUGIN_ROOT}/references/scrub-patterns.txt" \
         "$PLAYBOOK_DIR/scrub-patterns.local.txt" ; do
  [ -f "$f" ] && grep -hvE '^[[:space:]]*(#|$)' "$f" >> "$PATTERNS"
done
```

The local file is optional, so it is tested for rather than passed straight to `grep` — handed a path
that does not exist, `grep` returns an error status even though it read the file that does, and a
one-line pipeline that ends in an error status is how a step gets skipped without anyone noticing.

Then, on the copies only:

- Rewrite each match to a generic placeholder that keeps the sentence readable
  (`OrderRepository`, `src/app/module.py`, `<internal host>`).
- Rewrite each anchor's `path` to a generic form — the shape of the tree, not your tree.
- Set `source: contributed`.

### 4. The gate — this is what makes it verifiable

The gate re-reads the scrubbed **files themselves**. Not `git grep`: nothing is committed or staged at
this point in the flow, and `git grep` searches tracked content, so pointed at an untracked copy it
matches nothing and reports clean. A gate that inspects nothing and passes is worse than no gate — it
is the reason a human skim stops being careful.

So the gate refuses unless it can prove it had something to inspect on **both** sides, and proves it can
fire, before it is allowed to say clean:

```
# Nothing to match with, or nothing to match against → refuse. Never pass by vacuum.
test -s "$PATTERNS"     || { echo "no scrub patterns loaded";     exit 1; }
test -s "$WORK/submit.txt" || { echo "no files to inspect";       exit 1; }
while read -r f; do test -f "$f" || { echo "missing file: $f"; exit 1; }; done < "$WORK/submit.txt"

# Positive control: a line that MUST match. If it does not, the pattern list is broken and every
# clean result it gives is meaningless.
printf 'db-01.internal 10.0.0.4 me@example.com\n' | grep -qInE -f "$PATTERNS" - \
  || { echo "the pattern list matches nothing it should — refusing to push"; exit 1; }

# Negative control: ordinary technical prose that must NOT match. An over-broad pattern does not leak
# anything, it blocks every contribution — and since the gate has no override, that failure looks
# exactly like a leak. Both controls have to hold before a clean result means anything.
printf 'UTF-8, SHA-256 and ISO-8601 in settings.local.json\n' | grep -qInE -f "$PATTERNS" - \
  && { echo "a scrub pattern matches ordinary technical prose — fix the pattern, do not push"; exit 1; }

# The gate itself — the whole staging directory, so the file list cannot be silently short.
grep -rInE -f "$PATTERNS" "$WORK/submit"; STATUS=$?
```

Read that exit code **three** ways. Collapsing it into "non-zero means clean" is the same vacuous pass
in a different disguise, because that is also what a failed `grep` returns:

| `$STATUS` | What happened | What to do |
|---|---|---|
| `0` | at least one pattern matched | **refuse**, print every hit |
| `1` | every file was read, nothing matched | proceed |
| `2` or more | `grep` itself failed | **refuse** — an error is not a clean result |

**Refuse to push on any hit.** Show the hits and stop. The rewrite is best-effort; the gate is the
guarantee, and the two are deliberately separate steps so a missed rewrite cannot become a leaked name.

Then report **what was inspected** — how many patterns, and every filename by name — so "clean" is a
claim about specific files rather than about an empty list. Present the **full scrubbed diff** and take
an explicit yes. Do not summarize the diff; the user is approving what leaves their machine.

### 5. Pre-review before the branch

- A **gold** subject must pass
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --validate --gold-dir "$WORK/submit"` — the scrubbed copy,
  not the original. Its anchors will read as unreachable there, which is expected and not a failure: no
  `--repo-root` is given, so there is no repository to judge them against — and the paths were
  genericized a moment ago anyway.
- A **pattern or lesson** subject must already carry the promoted density format. That format is owned by
  `plugins/masterdevs/skills/playbook/SKILL.md` (mode 1's promote bullet) — read it there rather than
  restating it here.

### 6. Branch and push — in a throwaway clone, never in a checkout you work in

```
TMP="$(mktemp -d)"
git clone --depth 1 https://github.com/<upstream> "$TMP/masterclaude"
cd "$TMP/masterclaude"
git switch -c <type>/<slug>
cp "$WORK/submit/<id>.md" <its place in the clone>    # the gated copies, nothing else
git add -A && git commit -m "<conventional commit>"
git push -u origin <type>/<slug>
```

Only files listed in `$WORK/submit.txt` may be copied in. Anything else has not been through the gate.

**Forbidden in this flow — these commands must never appear:**

- `git switch main`
- `git checkout main`
- any push to a default branch (`git push origin main`, `git push --force`, a push with no branch name)

A throwaway clone is what makes "never touches main" **structural** rather than a promise: there is no
main checked out anywhere for the flow to reach. Confirm the resolved `--upstream` target back to the
user **before** the push, so a default cannot silently send a test run to the production repository, and
`rm -rf "$TMP" "$WORK"` at the end.

### 7. Open the pull request

```
gh pr create --repo <upstream> --base main --head <branch> --title "<title>" --body "<body>"
```

The title must be a conventional commit with a **lowercase subject**, matching the types
`.github/workflows/pr-title.yml` accepts (`feat|fix|perf|refactor|docs|test|ci|chore`):

- `feat(gold): add a repository-shaped data access example` — a gold entry
- `feat(playbook): add the guarded-suspension detection row` — a pattern or lesson

Body: what the entry shows, where it came from in **generic** terms, and one line stating that maintainer
review on GitHub is the gate.

If `gh` is missing or unauthenticated, **stop and print the branch location** rather than half-completing.
A pushed branch with no pull request is recoverable; a half-run flow the user cannot see is not.

## Rules

- **Never operate in the user's current checkout.** Clone, branch, push, delete.
- **Never push to a default branch.**
- **Scrub on the upstream path only.** Team scope keeps real code — that is what team scope is for.
- **The gate, not the rewrite, is the guarantee.** Refuse on any hit; never redact-and-continue.
- **A gate that inspected nothing has not passed.** No patterns loaded, no files listed, a file in the
  list missing, the positive control not matching, or `grep` itself erroring — every one of those is a
  refusal, never a clean result. "I found no problems" must mean "I read these files and found none".
- Nothing here promotes anything. Upstream, the maintainer's review decides; at team scope, the
  repository's own review does.
