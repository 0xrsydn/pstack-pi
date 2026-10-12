import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	applyBudget,
	INHERIT_PARENT,
	makeUpstreamPairConfig,
	migrateLegacyConfig,
	parseConfig,
	readConfig,
	ROLE_SPECS,
	writeConfig,
} from "./config.ts";

test("upstream pair covers every exact role", () => {
	const config = makeUpstreamPairConfig("large", "opencode/grok-4.7", "anthropic/claude-opus-5-5");
	assert.deepEqual(Object.keys(config.roles).sort(), ROLE_SPECS.map((role) => role.id).sort());
	assert.deepEqual(config.roles["arena-runners"], [
		{ model: "anthropic/claude-opus-5-5", thinking: "xhigh" },
		{ model: "opencode/grok-4.7", thinking: "xhigh" },
	]);
});

test("budget updates explicit models and preserves parent inheritance", () => {
	const config = makeUpstreamPairConfig("large", "opencode/grok-4.7", INHERIT_PARENT);
	const updated = applyBudget(config, "small");
	assert.deepEqual(updated.roles["feature-refactoring"], {
		model: "opencode/grok-4.7",
		thinking: "medium",
	});
	assert.deepEqual(updated.roles["judgment-prose"], { model: INHERIT_PARENT });
});

test("legacy four-role config migrates to exact roles", () => {
	const migrated = migrateLegacyConfig({
		code: "opencode/grok-4.7",
		execution: "openai-codex/gpt-5.6-terra",
		judgment: "anthropic/claude-opus-5-5",
		panel: ["anthropic/claude-opus-5-5", "opencode/grok-4.7"],
	});
	assert.equal(migrated?.roles["feature-refactoring"] && !Array.isArray(migrated.roles["feature-refactoring"])
		? migrated.roles["feature-refactoring"].model
		: undefined, "opencode/grok-4.7");
	assert.equal(migrated?.roles["bug-fix"] && !Array.isArray(migrated.roles["bug-fix"])
		? migrated.roles["bug-fix"].model
		: undefined, "openai-codex/gpt-5.6-terra");
	assert.equal(migrated?.roles["judgment-prose"] && !Array.isArray(migrated.roles["judgment-prose"])
		? migrated.roles["judgment-prose"].model
		: undefined, "anthropic/claude-opus-5-5");
});

test("parser rejects unknown roles and invalid panel shapes", () => {
	assert.throws(
		() => parseConfig({ version: 1, budget: "large", roles: { nope: { model: INHERIT_PARENT } } }),
		/unknown role/,
	);
	assert.throws(
		() => parseConfig({ version: 1, budget: "large", roles: { "arena-runners": [] } }),
		/non-empty array/,
	);
});

test("config writes atomically and reads back", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pstack-config-test-"));
	const file = join(dir, "pstack-models.json");
	try {
		const config = makeUpstreamPairConfig("medium", "opencode/grok-4.7", "anthropic/claude-opus-5-5");
		await writeConfig(config, file);
		assert.deepEqual(readConfig(file), { config, legacy: false });
		assert.equal(JSON.parse(await readFile(file, "utf8")).version, 1);
		await writeFile(file, "{not-json", "utf8");
		assert.match(readConfig(file).error ?? "", /Invalid JSON/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
