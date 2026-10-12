---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement, ownership, or layering questions. Explains subsystem architecture, runtime flow, and onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem. Build a working mental model instead of annotating source code.

Use `pstack_task` with `agent: "general-purpose"` and `readonly: true` for every delegation.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple.** For one module, utility, or narrow question, skip explorers. Spawn one explainer with `role: "how-explainer"`. Build its prompt from `references/explainer-prompt.md` without the explorer-findings section. Continue at step 4.
- **Complex.** For a subsystem spanning files or services, continue at step 2.

When in doubt, use the simple path.

## 2. Explore complex questions

Decompose the question into two to four distinct angles. Spawn all explorers in one `pstack_task` parallel call. Set `role: "how-explorer"` on every task. Fill each angle into `references/explorer-prompt.md`.

## 3. Synthesize

After all explorers return, spawn one explainer with `role: "how-explainer"`. Use `references/explainer-prompt.md` and include every explorer finding.

## 4. Present

Present the explainer output. Light edits for clarity are acceptable. Do not substantially rewrite it.

## Output format

Use the applicable sections from `references/explainer-prompt.md`: Overview, Key Concepts, How It Works, Where Things Live, and Gotchas.
