# Changelog

Versions identify pstack-pi releases, not upstream Cursor pstack parity. Release tags are immutable.

## 0.17.0

### Added

- Port ten portable upstream skills: `correct`, `sharpen`, `in-your-own-words`, `ketchup`, `benchmark-checklist`, `create-formal-verification-skill`, `maintain-formal-verification-skill`, and three principle leaves (`principle-attack-the-premise`, `principle-explain-the-number`, `principle-test-behavior-not-implementation`).
- Route `benchmark-checklist` and user-requested `ketchup` from poteto-mode, restate the goal on a task's first message, and list the three new principles beside the existing leaves. `correct`, `sharpen`, and `in-your-own-words` stay explicit user commands.
- Adapt `/ketchup` to Pi's terminal: link screenshots and videos instead of embedding them, and replace the `/visualize` reference with text and Mermaid diagrams.
- Point generated formal verification at counterexample traces read in the code's terms, because the port does not include `/statechart`.

### Changed

- Port upstream's `check-plan.mjs` fence handling and its test file. Keep the orch tests in the script test command because this port still ships `scripts/orch/`.
- Port the `watch-pr` pagination, fork-head, and deadline-cap fixes with their tests.
- Port the `worktree-audit.sh` base-ref, stat, and date fixes. Keep the Pi session directory as the transcript source.
- Drop "Must always apply." from the `unslop` description, which contradicted its `disable-model-invocation` setting.

### Removed

- Delete the unused `how` critic prompt and critique rubric references, which upstream removed.

### Fixed

- Exclude vendored `node_modules` from the published package. The `files` entry for `skills` packed about 1000 dependency files.
- Replace automate-me's assumed transcript directory with tested, workspace-scoped Pi session retrieval.
- Report history coverage and retrieval failures before proposing personal rules. Require user confirmation.
- Remove the missing skill-authoring dependency and mandatory Git worktree, commit, and pull-request steps.
- Match structured questions and skill invocation to Pi's interfaces.

## 0.16.0

### Added

- Native `/setup-pstack` using Pi's authenticated model registry and built-in selection dialogs.
- All 17 upstream routing roles, configurable panel lists, and per-task model and thinking overrides.
- `pstack_task` with isolated single, parallel, and chain execution based on Pi's official subagent example.
- Strict routing validation, atomic config writes, and migration from the legacy four-role configuration.
- TypeScript checks and six configuration and setup tests.
- Documentation for model customization, Pi primitives, trust limits, extension loading, and release procedures.

### Changed

- Rename the generic `subagent` tool to `pstack_task` to avoid collisions with other extensions.
- Move the extension entry point from `extensions/subagent/` to `extensions/pstack/`.
- Adapt the bundled workflow skills to exact role IDs and Pi-native delegation.
- Separate model identity from Pi thinking levels. Grok 4.7 and Claude Opus 5.5 are customizable preset recommendations.
- Include child model usage in tool results for Pi session accounting.

### Migration

- Update custom prompts that call the old `subagent` tool to call `pstack_task`.
- Remove manually installed copies of this extension before installing the package.
- Run `/setup-pstack` to review or migrate `~/.pi/agent/pstack-models.json`.
- Restart Pi or run `/reload`. Skill invocation is not required to activate the extension.
- Parent model defaults and personal provider routes remain separate user configuration.

### Known limits

- The port is not fully synchronized with newer upstream skills, including `correct`, `ketchup`, and additional principles.
- Parallel calls accept eight tasks and run four children concurrently.
- Delegation is not a filesystem sandbox, a durable background-job service, or an automatic worktree manager.
- Child processes load their own Pi resources. Parent-only command-line extension paths are not forwarded.
