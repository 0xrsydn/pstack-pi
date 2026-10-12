# pstack-pi

A Pi-native port of [pstack](https://github.com/cursor/plugins/tree/main/pstack), Lauren Tan's rigorous engineering workflow for Cursor.

The original skills, workflows, and prose are MIT-licensed work by Lauren Tan. This repository adapts harness-specific behavior to Pi.

## Install

Use a pinned Git tag or commit for reproducible installs:

```bash
pi install git:github.com/0xrsydn/pstack-pi@v0.16.0
```

During development, load the local checkout:

```bash
pi -e /path/to/pstack-pi
```

Restart Pi after installation. Run `pi list` to confirm that the package resources loaded.

## Set up models

Run the native command:

```text
/setup-pstack
```

The command:

1. Reads authenticated models from Pi's model registry.
2. Asks for the pstack reasoning budget.
3. Recommends the upstream Grok 4.7 and Claude Opus 5.5 pair when available.
4. Shows every upstream routing role.
5. Validates each model before saving.
6. Writes `~/.pi/agent/pstack-models.json` atomically.

Pi separates model identity from thinking level. The config follows the same design:

```json
{
  "version": 1,
  "budget": "large",
  "roles": {
    "feature-refactoring": {
      "model": "opencode/grok-4.7",
      "thinking": "xhigh"
    },
    "judgment-prose": {
      "model": "anthropic/claude-opus-5-5",
      "thinking": "xhigh"
    },
    "arena-runners": [
      {
        "model": "anthropic/claude-opus-5-5",
        "thinking": "xhigh"
      },
      {
        "model": "opencode/grok-4.7",
        "thinking": "xhigh"
      }
    ]
  }
}
```

Provider names are examples. `/setup-pstack` only offers models that Pi reports as available.

`"model": "inherit-parent"` inherits the active parent model and thinking level. A missing role also inherits the parent. Without a config, the extension resolves the upstream Grok 4.7 and Claude Opus 5.5 pair from Pi's available models. It falls back to the parent for an unavailable family. The command migrates the old `code` / `execution` / `judgment` / `panel` file when possible.

Budget mapping:

| Budget | Pi thinking level |
| --- | --- |
| `unlimited` | `max` |
| `large` | `xhigh` |
| `medium` | `high` |
| `small` | `medium` |

## Exact routing roles

pstack-pi keeps the current upstream role boundaries instead of collapsing them into generic tiers:

- `feature-refactoring`
- `bug-fix`
- `perf-issue`
- `hillclimb`
- `judgment-prose`
- `hardest-tasks`
- `how-explorer`
- `how-explainer`
- `why-investigators`
- `why-synthesizer`
- `reflect-tooling`
- `reflect-judgment-divergent-synthesizer`
- `arena-runners`
- `arena-cross-judge-pool`
- `swarm-workers`
- `architect-runners`
- `interrogate-reviewers`

Panel roles contain a list. `pstack_task` cycles that list in order. The arena cross-judge role prefers a model family different from the parent model.

## Pi-native delegation

The package registers `pstack_task`, a focused tool based on Pi's official subagent example. It starts isolated Pi subprocesses and supports:

- One task.
- Parallel `tasks[]` with bounded concurrency.
- Sequential `chain[]` with `{previous}` substitution.
- Per-task model and thinking overrides.
- Exact pstack role routing.
- Read-only tool restriction.
- Streaming progress, usage, errors, and cancellation.
- Package, user, and trusted project agent definitions.

The dedicated name avoids collisions with other Pi subagent extensions. pstack-pi does not require `pi-subagents`, tmux, or another orchestration package.

Package agents have the lowest precedence. User agents in `~/.pi/agent/agents/` and project agents in `.pi/agents/` can override them.

## Cursor-to-Pi mapping

| Cursor concept | Pi adaptation |
| --- | --- |
| `/setup-pstack` skill-driven setup | Native `/setup-pstack` extension command |
| `Task` | `pstack_task` |
| `subagent_type` | `agent` |
| Task model slug with effort suffix | `provider/model-id` plus separate `thinking` |
| `generalPurpose` | Bundled `general-purpose` agent |
| Background task fan-out | One bounded parallel `tasks[]` call |
| Cursor model rule | Versioned `~/.pi/agent/pstack-models.json` |
| Cursor skill paths | Pi package skills and `.pi/skills/` |

## Skills

Invoke the main mode explicitly:

```text
/skill:poteto-mode
```

Other explicit skills use `/skill:<name>`, for example `/skill:arena`, `/skill:why`, or `/skill:interrogate`.

The package retains Pi's progressive skill loading. Most pstack skills use `disable-model-invocation: true` and load only when explicitly invoked or referenced by another pstack workflow.

Cursor Cloud Automations are not included. Cursor-specific control plugins degrade to direct verification through the tools available in the Pi session.

## Development

Requirements:

- Pi 1.1.0 or newer.
- Node.js 22.19 or newer.

Run the checks:

```bash
npm install --ignore-scripts
npm run check
```

The tests cover config validation, budget application, legacy migration, and atomic persistence. TypeScript checks the extension against Pi's public extension types.
