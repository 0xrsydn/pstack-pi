# Changelog

Versions identify pstack-pi releases, not upstream Cursor pstack parity. Release tags are immutable.

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
