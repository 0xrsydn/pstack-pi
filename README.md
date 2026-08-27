# pstack-pi

A pi port of [pstack](https://github.com/cursor/plugins/tree/main/pstack), Lauren Tan's Cursor plugin. Original content is MIT-licensed (see LICENSE); this port keeps its structure and wording and adapts Cursor-specific mechanics to pi.

> **Acknowledgment:** all skills, workflows, and prose originate from Lauren Tan's [pstack](https://github.com/cursor/plugins). This repository only ports them to pi.

## Quick start

```bash
pi install npm:pstack-pi
```

## What ships

- **`skills/`** — all 45 original workflow and principle skills (`poteto-mode`, `swarm`, `arena`, `interrogate`, `how`, `why`, `reflect`, the `principle-*` set, etc.), rewritten where they referenced Cursor-specific mechanics.
- **`agents/`** — subagent definitions discovered by the bundled extension: `poteto-agent`, `comment-sicko`, and `general-purpose` (replaces Cursor's built-in `generalPurpose` task agent).
- **`extensions/subagent/`** — pi's example subagent tool, extended for pstack:
  - Per-task `model` override (with pstack's `inherit-parent` / `auto` aliases), so one parallel call can mix models.
  - Per-task `readonly` flag (restricts to `read,grep,find,ls`).
  - Discovers the bundled `agents/` directory from inside the package. User (`~/.pi/agent/agents/`) and project (`.pi/agents/`) definitions win over bundled ones.
  - Single, parallel (`tasks[]`), and chain modes are unchanged otherwise.

## Install

```bash
pi install npm:pstack-pi        # from npm (recommended, version-pinned)
pi install git:github.com/0xrsydn/pstack-pi   # or from git
```

After installing, confirm resources load with `pi list`.

## Model configuration

Run the `setup-pstack` skill ("/skill:setup-pstack", or ask the agent to configure pstack models). It:

1. Detects your models with `pi --list-models`.
2. Asks which model each role uses (code delegates, judgment/prose, review panels, swarm workers).
3. Writes `~/.pi/agent/pstack-models.md`.

The parent agent reads that file before spawning and passes each role's value as the `model` field of its `subagent` task entry. Delete a line to fall back to that skill's inline default; delete the file to fall back everywhere. There is no requirement to run setup — defaults described inline in the skills apply, but they reference placeholder model names from the upstream plugin until you write real ones.

## Adaptations from the original

| Cursor mechanic | pi equivalent |
| --- | --- |
| `Task` tool, `subagent_type` | `subagent` tool, `agent` field |
| `generalPurpose` built-in agent | bundled `general-purpose` agent |
| Task-level `model` slug | task-level `model` field (`provider/model-id` form) |
| `run_in_background`, cloud workers | parallel `tasks[]` calls run concurrently with isolated contexts; all local |
| `environment: "cloud"` / cloud VMs | removed; lanes run in worktrees on this machine |
| `~/.cursor/rules/pstack-models.mdc` | `~/.pi/agent/pstack-models.md` (plain markdown, read before spawns) |
| `~/.cursor/skills/` paths | `~/.pi/agent/skills/`; project `.cursor/skills/` → `.pi/skills/` |
| Session transcripts under `~/.cursor/projects/<slug>/agent-transcripts/` | `~/.pi/agent/sessions/<dashed-repo-path>/*.jsonl` |
| Cursor's built-in `create-skill` / babysit skills | generic authoring guidance; pstack's own playbooks cover these requests |
| `deslop`, `control-ui`/`control-cli` (`cursor-team-kit`) references | degraded gracefully: steps drop the plugin dependency or drive the surface directly |
| Bugbot review-bot comments | generalized to any bot reviewer comments |
| Slash commands like `/bro`, `/why` | `/skill:bro`, `/skill:why` (enable skill commands in settings) |

Not ported:

- **Cursor Cloud Automations** (`automations/benny/`) and the `grokbot` automation-webhook skill — no pi equivalent background-runner target.
- **`docs/guide/`** — read it [upstream](https://github.com/cursor/plugins/blob/main/pstack/docs/guide/README.md); most prose still applies apart from setup details.
- Skills that rely on MCP servers (for example parts of `why`) expect you to have equivalent data sources reachable through other tools.

## Requirements

- The bundled extension shells out to the `pi` binary on PATH (subagent tool).
- Panel/swarm fan-out works best with more than one provider configured.
