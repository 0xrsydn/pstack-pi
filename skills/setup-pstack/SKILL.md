---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and writes the model override file the skills read. Use for "configure pstack models", /skill:setup-pstack, or changing pstack's model choices.
---

# Setup pstack

Write `~/.pi/agent/pstack-models.md`, a plain markdown file that sets pstack's model per role. The parent agent reads it before spawning and passes each role's value as the `model` field of the `subagent` tool task entry. Skills fall back to their inline defaults when a line is absent, so this is an override layer, not a requirement.

## Steps

### 1. Detect available models

Run `pi --list-models` (optionally with a search term) and enumerate the returned slugs. Pi model slugs use the `provider/model-id` form (for example `anthropic/claude-opus-4-5`). Only write slugs that appear in the output. If you cannot detect any, ask the user to paste the slugs they have access to. Never write a real slug you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected slugs; both mean the role runs on the parent chat model.

### 2. Load current state

The default role-to-model mapping is the file shape shown in step 5 below. If `~/.pi/agent/pstack-models.md` already exists, read it and treat its values as the current choices. Otherwise start from those defaults. Note the example model names in this skill are placeholders from the original Cursor-era plugin; replace them with real slugs from your detected set.

### 3. Map and confirm

Show every role with its current model, marking any real slug not in the detected set as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` as options. Ask structured questions rather than free text. For panel roles (how critics, arena runners, architect runners, interrogate reviewers) the value is a comma-separated list, and one subagent runs per entry (each getting its own task entry with its `model` field), alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real slug written must be in the detected set; `inherit-parent` and `auto` always pass. If a chosen real slug is not available, stop and ask again. A config pointing at a model the user cannot use breaks every delegation that reads it.

### 5. Write the config

Overwrite `~/.pi/agent/pstack-models.md` wholesale so re-runs stay idempotent. One comment header plus one line per role, using the same labels poteto-mode uses. Shape:

```
# pstack model configuration. One line per role.
# Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit the task's `model`).
# Alias entries in a panel list still count toward its fan-out.
feature, refactoring: anthropic/claude-sonnet-4-5
bug-fix: anthropic/claude-opus-4-5
perf-issue: anthropic/claude-opus-4-5
hillclimb: anthropic/claude-opus-4-5
judgment and prose: anthropic/claude-opus-4-5
hardest tasks: anthropic/claude-opus-4-5
how explorer: anthropic/claude-haiku-4-5
how explainer: anthropic/claude-opus-4-5
how critics: anthropic/claude-opus-4-5, openai/gpt-5-codex, google/gemini-3-pro
why investigators: anthropic/claude-haiku-4-5
why synthesizer: anthropic/claude-opus-4-5
reflect tooling: openai/gpt-5-codex
reflect judgment, divergent, synthesizer: anthropic/claude-opus-4-5
arena runners: anthropic/claude-opus-4-5, openai/gpt-5-codex, google/gemini-3-pro
arena cross-judge pool: anthropic/claude-opus-4-5, openai/gpt-5-codex, google/gemini-3-pro
swarm workers: anthropic/claude-sonnet-4-5
architect runners: anthropic/claude-opus-4-5, openai/gpt-5-codex, google/gemini-3-pro
interrogate reviewers: anthropic/claude-opus-4-5, openai/gpt-5-codex, google/gemini-3-pro
```

Substitute every slug with one from the user's detected set before writing. Do not keep these examples.

### 6. Confirm

Tell the user the config was written, that it lives at `~/.pi/agent/pstack-models.md`, and that it applies to new spawns immediately because the parent reads it per spawn. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with create-verification-skill." On yes, run the create-verification-skill workflow. On no, move on without pushing.
