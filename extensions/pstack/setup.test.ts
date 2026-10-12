import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readConfig, ROLE_SPECS } from "./config.ts";
import { setupPstack } from "./setup.ts";

test("setup writes the upstream pair with the selected Pi budget", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "pstack-setup-test-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const answers = [
		"medium — high reasoning",
		"opencode/grok-4.7",
		"claude-bridge/claude-opus-5-5",
		"Save configuration",
	];
	const notifications: Array<{ message: string; type?: string }> = [];
	const context = {
		hasUI: true,
		model: { provider: "openai-codex", id: "gpt-5.6-sol" },
		modelRegistry: {
			getAvailable: () => [
				{ provider: "opencode", id: "grok-4.7", name: "Grok 4.7" },
				{ provider: "claude-bridge", id: "claude-opus-5-5", name: "Claude Opus 5.5" },
			],
		},
		ui: {
			select: async () => answers.shift(),
			notify: (message: string, type?: string) => notifications.push({ message, type }),
		},
	} as unknown as ExtensionCommandContext;

	try {
		await setupPstack("", context);
		assert.deepEqual(answers, []);
		const result = readConfig(join(agentDir, "pstack-models.json"));
		assert.equal(result.error, undefined);
		assert.equal(result.config?.budget, "medium");
		assert.equal(Object.keys(result.config?.roles ?? {}).length, ROLE_SPECS.length);
		assert.deepEqual(result.config?.roles["feature-refactoring"], {
			model: "opencode/grok-4.7",
			thinking: "high",
		});
		assert.deepEqual(result.config?.roles["judgment-prose"], {
			model: "claude-bridge/claude-opus-5-5",
			thinking: "high",
		});
		assert.equal(notifications.at(-1)?.type, "info");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(agentDir, { recursive: true, force: true });
	}
});
