## What changes for the user

<!-- Lead with the plain-English effect. A teammate one month into the codebase should follow this
     without opening the diff. Mechanism goes in a trailing clause. -->

## Why

<!-- What suggested this? If it's a loop-behavior change, the output of `node scripts/run-report.mjs`
     or a specific run that went badly is the most persuasive thing you can include. -->

## Checks

- [ ] `node scripts/loop-scenarios.mjs` passes
- [ ] `node scripts/mutation-check.mjs` passes
- [ ] New behavior has **both** a scenario and a mutation that breaks it
- [ ] Changed a skill or agent file? Tested in a **new session** (see CONTRIBUTING — the two halves load differently)

<!-- Don't bump versions or edit CHANGELOG.md — that's automated. Just make sure the PR title
     starts with feat:, fix:, docs:, etc. -->
