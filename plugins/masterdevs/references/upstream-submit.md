# Submitting one thing upstream

The shared mechanism for sending something off this machine to `MasterDevs/masterclaude` as a pull
request. Two callers use it, and neither restates it:

| Caller | Subject |
|---|---|
| `/masterdevs:gold` (destination **public**) | one gold entry |
| `/masterdevs:playbook` (mode 6) | one promoted pattern row or lesson entry |

The Playbook learns locally, and this is the only path out. **Nothing here promotes anything** — review
on GitHub is the gate.

## Resolve paths first

- `PLUGIN_ROOT` = `${CLAUDE_PLUGIN_ROOT}` (read-only; wiped on plugin update).
- `DATA_DIR` = `${CLAUDE_PLUGIN_DATA}` if it resolves to a real absolute path; **otherwise fall back**
  to `~/.claude/plugins/data/masterdevs-masterclaude/`. Never write under `PLUGIN_ROOT`.
- `PLAYBOOK_DIR` = `$DATA_DIR/playbook`

`--upstream <owner/repo>` overrides the destination, defaulting to `MasterDevs/masterclaude`. It accepts
a fork or a disposable remote, which is how this flow gets exercised without opening a real pull
request. **Confirm the resolved target back to the user before any push**, so a default cannot silently
send a test run to the production repository.

## 1. Eligibility

- A **gold entry** is eligible the moment it exists — a human captured it, and that is its gate.
- A **pattern or lesson** must already be **promoted**. A candidate is not eligible: it has not passed
  the recurrence-or-confirmation gate, and `/masterdevs:playbook` is where that happens.

## 2. Stage a copy — never the original

Scrubbing operates on a **copy**. The user's own lane is theirs; a submission is a derived artifact.
Stage the copies somewhere disposable and keep a list of exactly what is being submitted — the gate in
step 4 needs that list, and step 6 copies from it into the clone:

```
WORK="$(mktemp -d)"
mkdir -p "$WORK/submit"
cp "<the source file>" "$WORK/submit/<name>.md"
ls "$WORK"/submit/* > "$WORK/submit.txt"                      # one absolute path per line
```

## 3. Build the pattern list, then scrub

Two sources, in this order:

1. `${CLAUDE_PLUGIN_ROOT}/references/scrub-patterns.txt` — the shipped shape classes.
2. `$PLAYBOOK_DIR/scrub-patterns.local.txt` — the user's own organisation, repository and module names,
   if the file exists. Those cannot ship in a public repo, so the local file is where they live.

**Tracker ids are not in the shipped list**, and cannot be — no regex separates `PROJ-1234` from
`SHA-256`. So if the local file carries no tracker pattern, ask before going any further:

> No tracker-id pattern is configured, so `ENG-1234`-style references will not be scrubbed
> automatically. I read it and found none. **Recommend: proceed (y)** — or say the prefixes you use and
> I will add them to `scrub-patterns.local.txt` first.

Read the subject yourself before asking, and say what you actually found. Asking in the abstract puts
the work back on the user, which is how a question becomes a rubber stamp.

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
- For a gold entry, rewrite each anchor's `path` to a generic form — the shape of the tree, not the
  user's tree — and set `source: contributed`.

## 4. The gate — this is what makes it verifiable

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

## 5. Pre-review before the branch

- A **gold** subject must pass
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/gold.mjs --validate --gold-dir "$WORK/submit"` — the scrubbed copy,
  not the original. Its anchors will read as unreachable there, which is expected and not a failure: no
  `--repo-root` is given, so there is no repository to judge them against — and the paths were
  genericized a moment ago anyway.
- A **pattern or lesson** subject must already carry the promoted density format. That format is owned by
  `plugins/masterdevs/skills/playbook/SKILL.md` (mode 1's promote bullet) — read it there rather than
  restating it here.

## 6. Branch and push — in a throwaway clone, never in a checkout the user works in

```
TMP="$(mktemp -d)"
git clone --depth 1 https://github.com/<upstream> "$TMP/masterclaude"
cd "$TMP/masterclaude"
git switch -c <type>/<slug>
cp "$WORK/submit/<name>.md" <its place in the clone>    # the gated copies, nothing else
git add -A && git commit -m "<conventional commit>"
git push -u origin <type>/<slug>
```

Only files listed in `$WORK/submit.txt` may be copied in. Anything else has not been through the gate.

**Forbidden in this flow — these commands must never appear:**

- `git switch main`
- `git checkout main`
- any push to a default branch (`git push origin main`, `git push --force`, a push with no branch name)

A throwaway clone is what makes "never touches main" **structural** rather than a promise: there is no
main checked out anywhere for the flow to reach. Then `rm -rf "$TMP" "$WORK"` at the end.

## 7. Open the pull request

```
gh pr create --repo <upstream> --base main --head <branch> --title "<title>" --body "<body>"
```

The title must be a conventional commit with a **lowercase subject**, matching the types
`.github/workflows/pr-title.yml` accepts (`feat|fix|perf|refactor|docs|test|ci|chore`):

- `feat(gold): add a repository-shaped data access example` — a gold entry
- `feat(playbook): add the guarded-suspension detection row` — a pattern or lesson

Body: what the subject shows, where it came from in **generic** terms, and one line stating that
maintainer review on GitHub is the gate.

If `gh` is missing or unauthenticated, **stop and print the branch location** rather than
half-completing. A pushed branch with no pull request is recoverable; a half-run flow the user cannot
see is not.

## Rules

- **Never operate in the user's current checkout.** Clone, branch, push, delete.
- **Never push to a default branch.**
- **Scrub on this path only.** A team-scope gold entry keeps real internal identifiers verbatim — that
  is what team scope is for, and it is why scrubbing lives here rather than at capture time.
- **The gate, not the rewrite, is the guarantee.** Refuse on any hit; never redact-and-continue.
- **A gate that inspected nothing has not passed.** No patterns loaded, no files listed, a file in the
  list missing, either control failing, or `grep` itself erroring — every one of those is a refusal,
  never a clean result. "I found no problems" must mean "I read these files and found none".
- **Nothing here promotes anything.** The maintainer's review on GitHub decides.
