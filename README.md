# pstack-pi

A pi port of [pstack](https://github.com/cursor/plugins/tree/main/pstack), Lauren Tan's Cursor plugin. Original content is MIT-licensed (see LICENSE); this port keeps its structure and wording and adapts Cursor-specific mechanics to pi.

> **Acknowledgment:** all skills, workflows, and prose originate from Lauren Tan's [pstack](https://github.com/cursor/plugins). This repository only ports them to pi.

## Quick start

```bash
pi install npm:@0xrsydn/pstack-pi
```

Then run `/skill:setup-pstack` once to assign models per role (or skip it — every role defaults to your chat model).

## What ships

- **`skills/`** — 44 of the 45 original workflow and principle skills (`poteto-mode`, `swarm`, `arena`, `interrogate`, `how`, `why`, `reflect`, the `principle-*` set, etc.), rewritten where they referenced Cursor-specific mechanics. Only `grokbot/make-bot-ui` is dropped (see below).
- **`agents/`** — subagent definitions discovered by the bundled extension: `poteto-agent`, `comment-sicko`, and `general-purpose` (replaces Cursor's built-in `generalPurpose` task agent).
- **`extensions/subagent/`** — pi's example subagent tool, extended for pstack:
  - Per-task `model` override (with pstack's `inherit-parent` / `auto` aliases), so one parallel call can mix models.
  - Per-task `readonly` flag (restricts to `read,grep,find,ls`).
  - Discovers the bundled `agents/` directory from inside the package. User (`~/.pi/agent/agents/`) and project (`.pi/agents/`) definitions win over bundled ones.
  - Single, parallel (`tasks[]`), and chain modes are unchanged otherwise.

## Install

```bash
pi install npm:@0xrsydn/pstack-pi        # from npm (recommended, version-pinned)
pi install git:github.com/0xrsydn/pstack-pi   # or from git
```

After installing, confirm resources load with `pi list`.

## Model configuration (role routing)

Spawns carry a **role** (`code`, `execution`, `judgment`, `panel`), and the bundled extension resolves the role to a model at spawn time by reading `~/.pi/agent/pstack-models.json`:

```json
{
  "code": "opencode/grok-code",
  "execution": "anthropic/claude-sonnet-4-5",
  "judgment": "anthropic/claude-opus-4-5",
  "panel": ["anthropic/claude-opus-4-5", "openai/gpt-5-codex", "google/gemini-3-pro"]
}
```

- `code` — fast volume workers: feature/refactor delegates, swarm workers, explorers, investigators
- `execution` — precisely specified mechanical work: bug-fix, perf-issue, hillclimb, tooling reviews
- `judgment` — strongest reasoning: explainers, synthesizers, the hardest tasks
- `panel` — review fan-out; the value is a **list** and same-role tasks in one call cycle through it, one model per subagent

Native pi behavior is the default: no config file, a missing role, or the aliases `"inherit-parent"` / `"auto"` all resolve to the **parent chat model**. Role values can also be per-task overridden with an explicit `model` field (e.g. model races). Unknown role names fall back to the parent model.

Run the `setup-pstack` skill to generate this file: it detects your models with `pi --list-models`, asks which model each role uses, and writes the config. Skills reference roles only — no model slugs are hardcoded in the workflow prose.

## Adaptations from the original

| Cursor mechanic | pi equivalent |
| --- | --- |
| `Task` tool, `subagent_type` | `subagent` tool, `agent` field |
| `generalPurpose` built-in agent | bundled `general-purpose` agent |
| Task-level `model` slug | task-level `model` field (`provider/model-id` form) |
| `run_in_background`, cloud workers | parallel `tasks[]` calls run concurrently with isolated contexts; all local |
| `environment: "cloud"` / cloud VMs | removed; lanes run in worktrees on this machine |
| `~/.cursor/rules/pstack-models.mdc` | `~/.pi/agent/pstack-models.json`: role → model map read by the extension at spawn; unset roles inherit the parent model |
| `~/.cursor/skills/` paths | `~/.pi/agent/skills/`; project `.cursor/skills/` → `.pi/skills/` |
| Session transcripts under `~/.cursor/projects/<slug>/agent-transcripts/` | `~/.pi/agent/sessions/<dashed-repo-path>/*.jsonl` |
| Cursor's built-in `create-skill` / babysit skills | generic authoring guidance; pstack's own playbooks cover these requests |
| `deslop`, `control-ui`/`control-cli` (`cursor-team-kit`) references | degraded gracefully: steps drop the plugin dependency or drive the surface directly |
| Bugbot review-bot comments | generalized to any bot reviewer comments |
| Slash commands like `/bro`, `/why` | `/skill:bro`, `/skill:why` (enable skill commands in settings) |

Trigger behavior matches upstream: 39 of the 44 skills set `disable-model-invocation: true`, so they run only when you invoke them (`/skill:name` or by name in conversation) or when another skill reads their file by path. `how`, `why`, `setup-pstack`, `typescript-best-practices`, and `unslop` auto-trigger on matching tasks.

Not ported:

- **Cursor Cloud Automations** (`automations/benny/`) and the `grokbot` automation-webhook skill — no pi equivalent background-runner target.
- **`docs/guide/`** — read it [upstream](https://github.com/cursor/plugins/blob/main/pstack/docs/guide/README.md); most prose still applies apart from setup details.
- Skills that rely on MCP servers (for example parts of `why`) expect you to have equivalent data sources reachable through other tools.

## Requirements

- The bundled extension shells out to the `pi` binary on PATH (subagent tool).
- Panel/swarm fan-out works best with more than one provider configured.
