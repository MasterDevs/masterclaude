# Security

## Reporting a vulnerability

Please report privately via [GitHub Security Advisories](https://github.com/MasterDevs/masterclaude/security/advisories/new)
rather than opening a public issue. Expect an acknowledgement within a few days.

## What this plugin does on your machine

Worth knowing before you install anything that drives agents over your codebase:

- **It runs agents with tool access in your current worktree.** They read, write, and run commands there.
  The loop is designed to stop and ask before anything destructive, and Verify explicitly refuses risky
  or irreversible steps — it lists them under `needsApprovalFor` for you to run yourself.
- **Reviewers are strictly read-only.** They may not edit files, run the test suite, or use
  `git stash`/`checkout`/`reset`, because a verifier is reading the same worktree concurrently.
- **It writes outside your repo by design.** Requirements, plans, and learned knowledge live under
  `~/.claude/plugins/data/`, so nothing needs gitignoring and nothing lands in your history.
- **No network calls of its own.** No telemetry, no phoning home. The bundled scripts read local state
  and use only the Node standard library — there are no third-party dependencies to audit.

## The playbook is a trust boundary

The plugin learns: agents stage patterns and lessons, and promoted entries are loaded into the context of
**every future agent**. That makes promotion a security-relevant action — a bad or hostile entry becomes a
standing injection into all later runs.

So promotion is gated. An entry reaches the promoted lane only by recurring twice or more across
independent sightings, or by your explicit confirmation through `/masterdevs:playbook`. Agents may only
write to `*.candidates.md`, never to a promoted lane, and that rule is stated in every agent definition.

If you share a playbook directory between machines or people, treat it as executable content and review
it the way you would review a dependency.

## Supported versions

Pre-1.0: fixes land on the latest minor version only. Upgrade to receive them.
