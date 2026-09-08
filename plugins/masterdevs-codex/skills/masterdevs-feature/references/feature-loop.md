# Codex feature-loop protocol

## Paths and state

`SKILL_DIR` is the directory containing the selected `SKILL.md`; `PLUGIN_ROOT` is two directories above it.

For a new feature run, execute:

```bash
node "$PLUGIN_ROOT/scripts/codex-state.mjs" init --json
```

Use the returned absolute paths for the run, requirements, plan, verification log, repository verification notes, and Playbook. Mutable state defaults to a stable repository-keyed directory under the system temp root, so it is shared by worktrees, stays inside the normal Codex sandbox, and never dirties the application worktree. A user may set an absolute writable `MASTERDEVS_DATA_DIR` when durable cross-repository learning is more important than zero-setup sandbox compatibility.

Before loading Playbook knowledge, run the deterministic promotion gate:

```bash
node "$PLUGIN_ROOT/scripts/playbook.mjs" --playbook-dir "<playbookDir>" --promote
```

For a continuation, execute `codex-state.mjs latest --status awaiting-approval,running,needs-attention --json`, read its `requirementsPath`, `planPath`, and `run.json`, and resume that run. Do not silently resume a completed run.

Record transitions with:

```bash
node "$PLUGIN_ROOT/scripts/codex-state.mjs" record --run-dir "<runDir>" --phase "<phase>" --status "<status>" --message "<short message>"
```

## 1. Interview

Read `$PLUGIN_ROOT/references/interview.md` and follow it. Skip only when the brief already states outcome, beneficiary, success, constraint, out-of-scope behavior, and verification data at roughly 95% confidence. Otherwise ask one question per turn with a guess attached. The confirmed seven-field intent is authoritative.

## 2. Preflight

Run `node "$PLUGIN_ROOT/scripts/preflight.mjs" --json`. Report warnings and ask whether to continue; never repair checkout state automatically. If clean, continue without another question.

## 3. Refine

Delegate one read-only subagent to research the relevant code and turn the confirmed intent into:

```json
{
  "requirements": "settled, terse requirements",
  "researchNotes": "evidence from the code",
  "successCriteria": [{"name": "behavior", "kind": "happy|failure|edge", "check": "how to prove it"}],
  "verifyMethod": {"approach": "live or integration proof", "dataSource": "specific available data", "riskySteps": []},
  "openQuestions": []
}
```

The subagent must not reopen confirmed preferences. Blocking code contradictions stop for the user. Write a readable requirements artifact ending in the exact JSON inside a fenced `json` block.

## 4. Plan and criteria check

Run two read-only subagents in parallel:

1. An architect explicitly using `$masterdevs-architect`, given requirements, success criteria, relevant Playbook catalogs, refactor backlog, and absolute output expectations.
2. A criteria checker looking only for contradictions, unreachable targets, and criteria that cannot be verified with the named data. It returns `{issues:[{kind,criteria,problem,evidence,soWhat}]}` where kind is `contradiction`, `unreachable-target`, or `unverifiable`.

Contradictions and unreachable targets stop before implementation. Unverifiable criteria become plan-gate caveats.

Fact-check every architect `claim` with a separate read-only subagent. It must run the stated check or a better one and return `verified`, `refuted`, or `unverifiable` with evidence. If any claim is refuted, give the architect one revision pass, then fact-check again. Do not allow further automatic revisions.

Write a readable plan artifact ending in the exact plan JSON inside a fenced `json` block.

## 5. Approval gate

Record `phase=Plan status=awaiting-approval`. Present:

- the approach and ordered steps;
- the success criteria and real verification data source;
- every unverifiable criterion or plan claim;
- a count of verified claims and a brief note about any corrected claim.

Ask the user to approve, edit, or reject. Stop the turn. Tell them that edits to the plan artifact are authoritative and that replying with `$masterdevs-feature continue` resumes implementation.

## 6. Implementation loop

On approval, reread both artifacts; never rely on an earlier in-memory copy. Record `status=running`.

Run at most two outer rounds. Only critical/high findings or failed verification may buy round two. Keep medium/low revisions for one final Polish pass.

For each round:

1. **Implement:** delegate one workspace-writing subagent explicitly using `$masterdevs-engineer`. Give it the complete approved requirements, all plan steps on round one or only approved blocking revisions on round two, relevant lessons, Playbook path, verification-notes path, and the instruction to run scoped tests only.
2. **Refactor:** after implementation finishes, delegate a fresh `$masterdevs-engineer` subagent. It may read repository-wide for duplication but may edit only the feature scope. It applies behavior-preserving improvements and runs scoped tests.
3. **Verify and Review in parallel:**
   - A read-only verifier owns the full-suite gate and live success criteria. It reads repository verification notes and this run's verification log, runs the full suite at most once for the current tree fingerprint, and returns `{passed, results, failures, needsApprovalFor, impossible, suiteFingerprint}`. It may update only the two verification note files named by the parent.
   - A read-only reviewer panel reviews only the changed code. Build it from `playbook/rosters/reviewers.codex.defaults.json` — `$masterdevs-reviewer` alone by default — plus any entries in `playbook/rosters/reviewers.codex.user.json`, where a user entry replaces a shipped default of the same `name`. Run the entries whose triggers match the change; an entry with no `triggers`, or with `lens: "all"`, always runs. If the user file is absent, empty, or unreadable, run the shipped defaults alone.
4. **Verification fixes:** after review finishes, if verification failed for fixable behavior, run a fresh `$masterdevs-engineer` fix agent and reverify only those failures plus the full-suite fingerprint gate. At most two fix attempts. An impossible criterion stops immediately for the user.
5. **Iterate:** partition results into `mustFix` (critical/high or failed verification), `polish` (safe medium/low), `conflicts` (approved-scope clash), and `deferred`. A conflict stops. Continue only when `mustFix` is nonempty or verification failed and a round remains.

Never run two workspace-writing agents concurrently. Never let a reviewer or verifier stash, reset, clean, switch branches, or edit application files.

## 7. Polish and final checks

If safe medium/low revisions remain, run one fresh `$masterdevs-engineer` Polish agent. Skip anything that requires a design decision. Re-run the regression gate only if the tree fingerprint changed.

If verification fixes landed after review, run one final pass with the panel resolved above, scoped only to those fixes. Reviewer and engineer agents return Playbook candidates; serialize candidate-file updates in the parent after all concurrent agents finish. Never let concurrent subagents write candidate files.

## 8. Reporting

Read `$PLUGIN_ROOT/references/reporting.md`. Report against the confirmed success criteria, not an internal status.

Needs-you items include conflicts, impossible criteria, risky verification steps, unresolved critical/high findings, and blocking escalations. Each gets a recommendation and default. For the record, summarize polish, punted items, deferred items, and resolved escalations in one line each. State which tests and live checks actually ran, whether the last full-suite fingerprint still matches, and the artifact paths.

Record `completed`, `needs-attention`, or `blocked` before returning. Keep the report under the shared 25-line cap.
