---
name: setup-pstack
description: Explain or troubleshoot pstack model routing. Use for pstack setup questions, configuration errors, or requests to change pstack models. The native /setup-pstack command performs interactive configuration.
---

# Setup pstack

Use the native `/setup-pstack` command for configuration. Do not create model slugs from memory and do not edit the file unless the command cannot run.

The command uses Pi's authenticated model registry. It asks for a reasoning budget, starts from the upstream Grok 4.7 and Claude Opus 5.5 pair, shows every upstream role, validates all selections, and writes `~/.pi/agent/pstack-models.json` atomically.

Pi stores model identity and thinking level separately. A role assignment has this shape:

```json
{
  "model": "provider/model-id",
  "thinking": "xhigh"
}
```

`"model": "inherit-parent"` inherits both the active parent model and its thinking level. Panel roles contain arrays of assignments. Their array length sets the fan-out count.

The exact role IDs are:

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

If `pstack_task` reports an invalid or unavailable model, run `/setup-pstack` again. The command also migrates the old four-role file when it can parse it.
