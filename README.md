# pstack-pi

A Pi-native port of [pstack](https://github.com/cursor/plugins/tree/main/pstack), Lauren Tan's rigorous engineering workflow for Cursor.

The original skills, workflows, and prose are MIT-licensed work by Lauren Tan. This repository adapts harness-specific behavior to Pi.

## Install

Use a pinned Git tag or commit for reproducible installs:

```bash
pi install git:github.com/0xrsydn/pstack-pi@fe0fdf170fde0c1c1275eec02a912c9a6153b1ab
```

During development, load the local checkout:

```bash
pi -e /path/to/pstack-pi
```

The pinned commit contains the Pi-native setup and routing implementation. Use a published tag when one is available.

Restart Pi after installation. Run `pi list` to confirm the package declaration.

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

Provider names are examples. Grok and Claude are recommendations, not requirements. All 17 roles accept any chat model available through Pi, including models registered by custom provider extensions. pstack-pi does not store credentials or require a particular provider.

`"model": "inherit-parent"` uses the active parent model and, unless overridden, its thinking level. The bundled agents have no fixed model. A missing role therefore inherits the parent when you use a bundled agent. A custom agent can supply its own model; see [routing precedence](#routing-precedence).

Without a config, the extension resolves the upstream Grok 4.7 and Claude Opus 5.5 pair from Pi's available models. It uses the `large` budget and falls back to the parent for an unavailable family. A partial config does not merge with that preset: omitted roles have no assignment.

The command migrates the old `code` / `execution` / `judgment` / `panel` file when possible.

Budget mapping:

| Budget | Pi thinking level |
| --- | --- |
| `unlimited` | `max` |
| `large` | `xhigh` |
| `medium` | `high` |
| `small` | `medium` |

The default budget is `large`. Budget names are not thinking-level names: a `medium` budget requests `high` thinking. Setup has no `low` budget option.

Pi limits the effective thinking level to what the selected model supports. Unlike Cursor, pstack-pi does not encode effort in a model slug or invent a new slug for an unsupported tier.

## Customize models

Run `/setup-pstack`, choose a budget, then select **Change one role** to edit any assignment. Panel roles let you choose models in order, including repeated models and `inherit-parent`. The interactive panel editor accepts up to eight entries.

For per-role thinking levels, edit `~/.pi/agent/pstack-models.json` directly. These levels are accepted:

```text
off, minimal, low, medium, high, xhigh, max
```

For example, this partial config uses GPT for code, Claude for judgment, and Grok at a lower effort for exploration:

```json
{
  "version": 1,
  "budget": "medium",
  "roles": {
    "feature-refactoring": {
      "model": "openai-codex/gpt-6.1-sol",
      "thinking": "high"
    },
    "judgment-prose": {
      "model": "anthropic/claude-opus-5-5",
      "thinking": "high"
    },
    "how-explorer": {
      "model": "opencode/grok-4.7",
      "thinking": "low"
    },
    "arena-runners": [
      { "model": "openai-codex/gpt-6.1-sol", "thinking": "high" },
      { "model": "anthropic/claude-opus-5-5", "thinking": "high" },
      { "model": "inherit-parent" }
    ]
  }
}
```

Use only routes available in your Pi session. A custom provider route can replace any example above. Unavailable configured models stop delegation and require a config update; pstack-pi does not silently substitute a different paid model.

The `budget` field records the setup choice. Explicit role `thinking` values control delegation. Re-running setup reapplies the selected budget to all explicit assignments, including panels, and replaces manual thinking differences.

Configuration is read on each `pstack_task` call. Changing it affects subsequent calls without restarting Pi. It does not switch the parent chat model. Use Pi's `/model` and `/thinking` for the parent; save those defaults separately for new sessions.

### Routing precedence

The `agent` selects instructions and tools. The `role` selects a model assignment. The bundled `poteto-agent` and `general-purpose` agents do not pin a provider or model.

The model is selected in this order:

1. Explicit per-task `model`.
2. Configured `role` assignment.
3. Custom agent frontmatter `model`, if present.
4. Active parent Pi model.

At either of the first two steps, `inherit-parent` or `auto` selects the parent directly and bypasses an agent's fixed model.

An explicit per-task `thinking` overrides the role's thinking value. When the model is inherited without an explicit thinking value, the child inherits the parent thinking level. An explicit model without a thinking value uses the child Pi default.

For a one-off override, ask Pi to call `pstack_task` with arguments such as:

```json
{
  "agent": "poteto-agent",
  "role": "feature-refactoring",
  "model": "openai-codex/gpt-6.1-sol",
  "thinking": "high",
  "task": "Implement the agreed change and run the relevant tests."
}
```

Supplying `model` bypasses the role assignment, including its thinking value. Supply `thinking` too when you need a specific effort. The same overrides work on individual `tasks[]` and `chain[]` entries.

## Exact routing roles

pstack-pi preserves all 17 upstream role boundaries. The preset assigns models as follows; every assignment can be changed.

| Role | Preset model | Assignment shape |
| --- | --- | --- |
| `feature-refactoring` | Grok 4.7 | Single |
| `bug-fix` | Grok 4.7 | Single |
| `perf-issue` | Grok 4.7 | Single |
| `hillclimb` | Grok 4.7 | Single |
| `judgment-prose` | Claude Opus 5.5 | Single |
| `hardest-tasks` | Claude Opus 5.5 | Single |
| `how-explorer` | Grok 4.7 | Single |
| `how-explainer` | Claude Opus 5.5 | Single |
| `why-investigators` | Grok 4.7 | Single |
| `why-synthesizer` | Claude Opus 5.5 | Single |
| `reflect-tooling` | Grok 4.7 | Single |
| `reflect-judgment-divergent-synthesizer` | Claude Opus 5.5 | Single |
| `arena-runners` | Claude Opus 5.5, Grok 4.7 | Panel |
| `arena-cross-judge-pool` | Claude Opus 5.5, Grok 4.7 | Panel |
| `swarm-workers` | Grok 4.7 | Single |
| `architect-runners` | Claude Opus 5.5, Grok 4.7 | Panel |
| `interrogate-reviewers` | Claude Opus 5.5, Grok 4.7 | Panel |

A single role requires one assignment object. A panel requires a non-empty list. Skills use the runner or reviewer list length to decide how many tasks to submit. The extension does not create extra tasks merely because a panel has more entries.

Within each tool call, `pstack_task` cycles each panel in order. The arena cross-judge pool supplies one judge and prefers a model family different from the parent model.

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

Package agents have the lowest precedence. User agents in `~/.pi/agent/agents/` can override them. With `agentScope: "both"`, project agents in `.pi/agents/` override both user and package agents. `agentScope: "project"` loads only project agents.

## System design: Pi primitives

pstack-pi preserves pstack workflows, not Cursor's runtime. It uses Pi's extension, skill, model, and package interfaces instead of recreating Cursor services. Child tasks use Pi's command-line interface (CLI).

| Responsibility | Pi primitive | pstack-pi choice |
| --- | --- | --- |
| Workflow instructions | Package skills and `/skill:<name>` | Load detailed instructions only when needed |
| Interactive configuration | `registerCommand()` and `ctx.ui.select()` | Native `/setup-pstack`, separate from a model turn |
| Available model discovery | `ctx.modelRegistry.getAvailable()` | Use Pi authentication and custom providers; no second catalog |
| Delegation | `registerTool()` with a TypeBox schema | One named `pstack_task` tool with three execution modes |
| Child execution | Pi CLI JSON/print mode | Separate process and context per task |
| Agent instructions | Markdown frontmatter and appended system prompt | Reusable agent definitions, separate from model roles |
| Progress and results | Tool `onUpdate`, `content`, and `details` | Stream progress and retain structured child results |
| Usage accounting | Tool-result `usage` | Report child model usage through Pi's session totals |
| Terminal display | Pi tool renderers and `pi-tui` components | Use the host theme and transcript, not another terminal UI |
| Persistent routing | `getAgentDir()` and `withFileMutationQueue()` | Versioned JSON, queued atomic writes, file mode `0600` |
| Distribution | `package.json` Pi resource manifest | Install extension and skills together from a pinned source |

### Why these choices

- **Skills for policy, extension code for execution.** Playbooks remain readable instructions. Validation and process management are executable operations.
- **Separate agent, role, and model.** Changing a provider does not require copying an agent prompt or rewriting a playbook.
- **Use Pi's provider layer.** Models and credentials stay under Pi control. Custom providers need no pstack-specific integration.
- **Use isolated CLI children.** This follows Pi's official subagent example and avoids shared conversation state. It adds process startup overhead.
- **Keep orchestration inside one tool call.** Single, parallel, and chain modes avoid a required background-task service or external orchestrator.
- **Use a dedicated tool name.** `pstack_task` avoids the generic `subagent` name used by other extensions.
- **Store routing outside session history.** Model choices apply across sessions. Child outputs and usage remain attached to the parent's tool results.

No `pi-subagents`, tmux, cloud-agent service, or custom Pi runtime is required. The implementation uses the Pi CLI rather than an in-process session from Pi's software development kit (SDK).

### Execution path

```text
/skill:poteto-mode or another pstack skill
  -> parent Pi selects agent + role + task
  -> pstack_task reads routing and discovers agents
  -> resolve model, thinking, tools, and working directory
  -> launch pi --mode json -p --no-session
  -> collect child messages and stream progress
  -> return content + details + usage to the parent
```

The child receives the task brief and agent instructions, not the parent conversation. The bundled `poteto-agent` also receives the packaged poteto-mode skill path.

### Limits and trust

- A parallel call accepts at most eight tasks and runs at most four children concurrently.
- A chain launches a fresh child for each step. `{previous}` passes the preceding text output, not a resumable child session.
- Calls wait for their children. They do not provide durable background jobs or Cursor-style resume handles.
- Cancellation forwards the tool abort signal to the child process. It is not an operating-system process-tree sandbox.
- Children share the working directory unless a task supplies `cwd`. The tool does not automatically create worktrees or prevent competing writes.
- `readonly: true` restricts built-in tools to `read,grep,find,ls`. It is not a filesystem sandbox and does not disable extension tools.
- Children load their own Pi resources. Extensions loaded only through the parent's command line are not automatically forwarded.
- Project agents are opt-in. Untrusted project agents require confirmation when a UI is available, unless confirmation is explicitly disabled.

Use trusted extensions and separate worktrees or non-overlapping file scopes for parallel writers.

Implementation: [extension](extensions/pstack/index.ts), [agent discovery](extensions/pstack/agents.ts), [routing config](extensions/pstack/config.ts), and [setup](extensions/pstack/setup.ts).

Pi references: [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md), [packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), and the [official subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent).

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

## Upstream scope

This port includes the Pi-native setup, all 17 routing roles, isolated delegation, and adaptations of the existing bundled workflows. It is not a complete synchronization with the latest Cursor pstack release.

Newer upstream skills, including `correct`, `ketchup`, and additional principle skills, remain follow-up work. Cursor-specific execution mechanics must be adapted to Pi before inclusion. Personal provider choices and the parent Pi default model are user configuration, not package defaults.

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
