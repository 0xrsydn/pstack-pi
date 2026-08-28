---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and writes the role config the subagent extension reads. Use for "configure pstack models", /skill:setup-pstack, or changing pstack's model choices.
---

# Setup pstack

Write `~/.pi/agent/pstack-models.json`, a JSON file mapping four roles to models. The subagent extension reads it at every spawn and resolves each task's `role` field to a model. Roles without an entry — and spawns made with no config file at all — run on the parent chat model, so this is an override layer, not a requirement.

## Roles

| Role | Covers | Upstream intent |
| --- | --- | --- |
| `code` | feature/refactor workers, swarm workers, explorers, investigators | fast, cheap volume work |
| `execution` | bug-fix, perf-issue, hillclimb, reflect tooling | precisely specified mechanical work |
| `judgment` | explainer, synthesizers, hardest tasks, prose | strongest reasoning |
| `panel` | how critics, arena runners, architect runners, interrogate reviewers | diverse-model review; value is a list, one model per subagent, cycled in order |

## Steps

### 1. Detect available models

Run `pi --list-models` (optionally with a search term) and enumerate the returned slugs. Pi model slugs use the `provider/model-id` form (for example `anthropic/claude-opus-4-5`). Only write slugs that appear in the output. If you cannot detect any, ask the user to paste the slugs they have access to. Never write a real slug you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected slugs; both mean the role runs on the parent chat model.

### 2. Load current state

If `~/.pi/agent/pstack-models.json` already exists, read it and treat its values as the current choices. Otherwise start from every role unset (parent chat model).

### 3. Map and confirm

Show each role with its current model, and ask whether to accept the parent-model default or assign specific models. Ask structured questions rather than free text. Recommendations by intent, chosen from the detected set: a fast/cheap model for `code`, a strong instruction-follower for `execution`, the strongest reasoning model for `judgment`, and for `panel` a list of 3–4 models from different provider families — one subagent per list entry, so the list length sets the panel size. Arena additionally prefers a judge whose model family differs from the parent's.

### 4. Validate

Every real slug written must be in the detected set; `inherit-parent` and `auto` always pass. If a chosen real slug is not available, stop and ask again. A config pointing at a model the user cannot use breaks every delegation that reads it.

### 5. Write the config

Overwrite `~/.pi/agent/pstack-models.json` wholesale so re-runs stay idempotent. Omit a role key entirely to leave it on the parent model. Shape:

```json
{
  "code": "<fast-model-slug>",
  "execution": "<instruction-follower-slug>",
  "judgment": "<strongest-reasoning-slug>",
  "panel": ["<slug-a>", "<slug-b>", "<slug-c>"]
}
```

Substitute every slug with one from the user's detected set before writing. Do not keep these placeholders.

### 6. Confirm

Tell the user the config was written, that it lives at `~/.pi/agent/pstack-models.json`, and that it applies to new spawns immediately because the extension reads it per spawn. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with create-verification-skill." On yes, run the create-verification-skill workflow. On no, move on without pushing.
