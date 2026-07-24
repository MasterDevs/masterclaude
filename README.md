# masterclaude

A Claude Code **plugin marketplace**. It currently ships one plugin, **`firm`** — a multi-agent feature-development pipeline (plan → build → review → integrate) over a self-learning design-pattern knowledge base.

## Install

```
/plugin marketplace add MasterDevs/masterclaude
/plugin install firm@masterclaude
```

(While the repo is private, `/plugin marketplace add` uses your authenticated GitHub access. You can also add it from a local clone: `/plugin marketplace add /path/to/masterclaude`.)

Then run:

```
/firm:feature <your feature brief>
```

## What's inside

| Plugin | Description |
|---|---|
| [`firm`](./plugins/firm) | Scout → Architect (→ Principal for multi-domain) → model-routed Engineers → extensible Review Panel → fix loop → integrate, with priority hierarchy security > reliability > velocity. See the [plugin README](./plugins/firm/README.md). |

## Repo layout

```
masterclaude/
├── .claude-plugin/marketplace.json   # marketplace manifest
├── plugins/firm/                     # the firm plugin (agents, skills, workflows, playbook seeds)
├── README.md
└── LICENSE
```

## Updating

Third-party marketplace plugins do **not** auto-update by default. After pushing new versions, reinstall/update from the `/plugin` menu. The `firm` plugin merges new shipped pattern/lesson seeds into your learned data on update — it never overwrites what you've customized.

## License

MIT — see [LICENSE](./LICENSE).
