---
name: review
description: "Run the masterdevs review panel over your current changes — security, performance, design, and correctness in one adversarial pass, reported as decisions rather than code notes. Use when you want a review without running the whole feature loop: before pushing, before opening a PR, or on work you wrote by hand. Invoke as /masterdevs:review [what to focus on]."
---

# /masterdevs:review — the review panel, on its own

The same reviewer the feature loop uses, pointed at whatever is in your worktree right now. No plan, no
implementation, no loop — just the review.

## Step 1 — Establish the diff

Work out what "the changes" means, in this order, and **say which one you picked** in one line:

1. The user named a base or range (`/masterdevs:review against main`, `…the last 3 commits`) — use it.
2. Uncommitted work exists (`git status --porcelain` is non-empty) — review the working tree against `HEAD`.
3. Otherwise — review this branch against its merge-base with the default branch.

If the diff is empty, say so and stop. If it's very large (say, >2000 changed lines), tell the user what
you're about to review and ask whether to narrow it before spending the tokens.

## Step 2 — Resolve the panel

- Always: `masterdevs:reviewer` on `opus`.
- Plus anything in `$DATA_DIR/playbook/rosters/reviewers.user.json` (each `{name, agentType, model}`),
  where `DATA_DIR` is `${CLAUDE_PLUGIN_DATA}` or `~/.claude/plugins/data/masterdevs-masterclaude/`.
  Absent or empty file → just the one reviewer.

Run them **concurrently** — one message, multiple agent calls. They only read.

## Step 3 — Brief each reviewer

Give each one:

- The diff scope you settled on in Step 1, and how to get it (`git diff <range>`).
- **Context for what this change is trying to do.** If the user gave focus with the command, pass it. If
  there's an obvious source — a branch name, a linked ticket, a recent commit message — use it and say
  you inferred it. If you genuinely don't know, say so rather than inventing intent; a reviewer that
  invents the goal reports against the wrong target.
- The instruction to review **only the changed code**, judging the change rather than the codebase.
- A reminder that they are **strictly read-only**: no edits, no test-suite runs, no `git stash`. Their
  agent definition says this; repeating it costs one line and it's the failure mode that wastes the most
  time.

Reviewers return findings with `severity`, `lens`, `file`, `line`, `summary`, `fix`, and `soWhat` — the
plain-language consequence, which is what the user actually reads.

## Step 4 — Report

Read `${CLAUDE_PLUGIN_ROOT}/references/reporting.md` and follow it.

For a standalone review specifically:

- **Bottom line:** is this safe to push? One sentence. If there are no critical/high findings, say that
  plainly — a clean review is a useful result, not an empty one.
- **Needs you:** critical and high findings only. Each gets its `soWhat`, your recommendation, and what
  happens by default. Deduplicate across reviewers — if two flag the same defect, that's one item, and
  worth noting that it was independently found.
- **For the record:** medium and low, one line each. Do not expand them.
- Close with the panel size and rough cost.

Nothing here is applied. This command reviews; it does not fix. If the user wants the fixes made, say so
and let them ask — or point them at `/masterdevs:feature` for a change large enough to want a plan.
