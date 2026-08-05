# masterclaude

A Claude Code **plugin marketplace**. It currently ships one plugin, **`masterdevs`** — a multi-agent feature-development pipeline (plan → build → review → integrate) over a self-learning design-pattern knowledge base.

## Install

```
/plugin marketplace add MasterDevs/masterclaude
/plugin install masterdevs@masterclaude
```

(While the repo is private, `/plugin marketplace add` uses your authenticated GitHub access. You can also add it from a local clone: `/plugin marketplace add /path/to/masterclaude`.)

Then run:

```
/masterdevs:feature <your feature brief>
```

## What's inside

| Plugin | Description |
|---|---|
| [`masterdevs`](./plugins/masterdevs) | Refine → Plan (you approve) → Implement → Refactor → Verify ∥ Review → Iterate → Polish, in one worktree with a fresh context per phase and priority hierarchy security > reliability > velocity. See the [plugin README](./plugins/masterdevs/README.md). |

## Repo layout

```
masterclaude/
├── .claude-plugin/marketplace.json   # marketplace manifest
├── plugins/masterdevs/                     # the masterdevs plugin (agents, skills, workflows, playbook seeds)
├── README.md
└── LICENSE
```

## Updating

Third-party marketplace plugins do **not** auto-update by default. After pushing new versions, reinstall/update from the `/plugin` menu. The `masterdevs` plugin merges new shipped pattern/lesson seeds into your learned data on update — it never overwrites what you've customized.

## License

MIT — see [LICENSE](./LICENSE).
