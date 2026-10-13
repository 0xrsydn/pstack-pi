import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { encodeSessionCwd, readHistory, UsageError } from "./read-history.mjs";

const SCRIPT = fileURLToPath(new URL("./read-history.mjs", import.meta.url));
const NOW = Date.parse("2026-10-13T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MS = NOW - 60 * 1000;
const RECENT_TS = "2026-10-12T23:59:00.000Z";

function isolated(extra = {}) {
	return {
		home: extra.home,
		env: extra.env ?? {},
		now: extra.now ?? NOW,
		cwd: extra.cwd,
		sessionDir: extra.sessionDir,
		since: extra.since,
		days: extra.days,
		summary: extra.summary,
		offset: extra.offset,
		limit: extra.limit,
		maxText: extra.maxText,
		maxPageBytes: extra.maxPageBytes,
	};
}

function skillBlock(name, location, body, args = "") {
	const block = `<skill name="${name}" location="${location}">\nReferences are relative to /skills/${name}.\n\n${body}\n</skill>`;
	return args ? `${block}\n\n${args}` : block;
}

async function tempRoot() {
	return mkdtemp(join(tmpdir(), "read-history-"));
}

function sessionHeader(cwd, id, extra = {}) {
	return {
		type: "session",
		version: 3,
		id,
		timestamp: "2026-10-01T00:00:00.000Z",
		cwd,
		...extra,
	};
}

function userEntry(id, parentId, text, ms = RECENT_MS, entryTs = RECENT_TS) {
	return {
		type: "message",
		id,
		parentId,
		timestamp: entryTs,
		message: { role: "user", content: text, timestamp: ms },
	};
}

function assistantEntry(id, parentId, text, ms = RECENT_MS + 1, entryTs = RECENT_TS) {
	return {
		type: "message",
		id,
		parentId,
		timestamp: entryTs,
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: ms,
		},
	};
}

async function writeJsonl(dir, name, lines, { trailingNewline = true } = {}) {
	await mkdir(dir, { recursive: true });
	const body = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");
	await writeFile(join(dir, name), trailingNewline ? `${body}\n` : body);
}

function runCli(args, { cwd, env } = {}) {
	return spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd,
		env: env ?? cleanEnv(),
		encoding: "utf8",
	});
}

function cleanEnv(extra = {}) {
	const env = { ...process.env, ...extra };
	if (!Object.hasOwn(extra, "PI_CODING_AGENT_DIR")) delete env.PI_CODING_AGENT_DIR;
	if (!Object.hasOwn(extra, "PI_CODING_AGENT_SESSION_DIR")) delete env.PI_CODING_AGENT_SESSION_DIR;
	return env;
}

test("encodeSessionCwd matches Pi and collides when slash and hyphen differ", () => {
	assert.equal(encodeSessionCwd("/Users/you/proj"), "--Users-you-proj--");
	assert.equal(encodeSessionCwd("/tmp/foo:bar"), "--tmp-foo-bar--");
	assert.equal(encodeSessionCwd("/tmp/proj/alpha-beta"), encodeSessionCwd("/tmp/proj/alpha/beta"));
});

test("missing session directory is no_history and does not throw", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const report = readHistory(isolated({ cwd, home }));
		assert.equal(report.status, "no_history");
		assert.equal(report.diagnostics.missing, 1);
		assert.deepEqual(report.messages, []);
		assert.equal(report.sessionDirSource, "default");
		assert.equal(report.window.days, 28);
		assert.equal(report.window.since, new Date(NOW - 28 * DAY_MS).toISOString());
		assert.equal(report.sessionDir, join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd)));
		assert.equal(report.workspace, realpathSync(cwd));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("foreign headers and encoded collisions stay out of the report", async () => {
	const root = await tempRoot();
	try {
		const left = join(root, "alpha-beta");
		const right = join(root, "alpha", "beta");
		const prefixed = join(root, "alpha-beta-extra");
		const nested = join(left, "sub");
		await mkdir(left, { recursive: true });
		await mkdir(right, { recursive: true });
		await mkdir(prefixed, { recursive: true });
		await mkdir(nested, { recursive: true });
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(left));
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_left.jsonl", [
			sessionHeader(left, "left"),
			userEntry("mine", null, "workspace text"),
		]);
		await writeJsonl(sessionDir, "2026-10-02T00-00-00-000Z_right.jsonl", [
			sessionHeader(right, "right"),
			"{not json SECRET_FOREIGN",
		]);
		await writeJsonl(sessionDir, "2026-10-03T00-00-00-000Z_prefix.jsonl", [
			sessionHeader(prefixed, "prefix"),
			userEntry("pref", null, "SECRET_PREFIX"),
		]);
		await writeJsonl(sessionDir, "2026-10-04T00-00-00-000Z_nested.jsonl", [
			sessionHeader(nested, "nested"),
			userEntry("nest", null, "SECRET_NESTED"),
		]);

		const report = readHistory(isolated({ cwd: left, home }));
		const json = JSON.stringify(report);
		assert.equal(report.status, "ready");
		assert.equal(report.diagnostics.foreign, 3);
		assert.equal(report.diagnostics.malformed, 0);
		assert.equal(report.coverage.filesRead, 1);
		assert.equal(report.coverage.filesSeen, 4);
		assert.equal(report.messages.length, 1);
		assert.equal(report.messages[0].text, "workspace text");
		assert.equal(json.includes("SECRET_"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("default lookup does not read sibling or loose session files", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessions = join(home, ".pi", "agent", "sessions");
		const encoded = join(sessions, encodeSessionCwd(cwd));
		await writeJsonl(encoded, "2026-10-01T00-00-00-000Z_ok.jsonl", [
			sessionHeader(cwd, "ok"),
			userEntry("ok", null, "in scope"),
		]);
		await writeJsonl(sessions, "loose.jsonl", [
			sessionHeader(cwd, "loose"),
			userEntry("loose", null, "SECRET_LOOSE"),
		]);
		await writeJsonl(join(sessions, encodeSessionCwd(join(root, "other"))), "other.jsonl", [
			sessionHeader(cwd, "other"),
			userEntry("other", null, "SECRET_OTHER_DIR"),
		]);
		await writeFile(join(encoded, "notes.txt"), "SECRET_NOTES");

		const report = readHistory(isolated({ cwd, home }));
		const json = JSON.stringify(report);
		assert.equal(report.messages.map((message) => message.text).join("\n"), "in scope");
		assert.equal(json.includes("SECRET_"), false);
		assert.equal(report.coverage.filesSeen, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("canonical header cwd matches, and a different directory does not", async () => {
	const root = await tempRoot();
	try {
		const real = join(root, "project");
		const alias = join(root, "alias");
		const other = join(root, "other");
		await mkdir(real);
		await mkdir(other);
		await symlink(real, alias);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(real));
		const dotted = join(root, "project", "..", "project");
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_alias.jsonl", [
			sessionHeader(alias, "alias"),
			userEntry("alias", null, "via alias"),
		]);
		await writeJsonl(sessionDir, "2026-10-02T00-00-00-000Z_dot.jsonl", [
			sessionHeader(dotted, "dot"),
			userEntry("dot", null, "via dot segments"),
		]);
		await writeJsonl(sessionDir, "2026-10-03T00-00-00-000Z_other.jsonl", [
			sessionHeader(other, "other"),
			userEntry("other", null, "SECRET_OTHER"),
		]);

		const report = readHistory(isolated({ cwd: real, home }));
		assert.deepEqual(
			report.messages.map((message) => message.text),
			["via alias", "via dot segments"],
		);
		assert.equal(JSON.stringify(report).includes("SECRET_OTHER"), false);
		assert.equal(report.diagnostics.foreign, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("all branches are kept once with parentId and file line entry pointers", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		const file = join(sessionDir, "2026-10-01T00-00-00-000Z_branched.jsonl");
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_branched.jsonl", [
			sessionHeader(cwd, "branched"),
			userEntry("u1", null, "root ask", RECENT_MS, "2026-10-12T23:00:00.000Z"),
			assistantEntry("a1", "u1", "root answer", RECENT_MS + 1, "2026-10-12T23:01:00.000Z"),
			userEntry("u2", "a1", "left branch", RECENT_MS + 2, "2026-10-12T23:02:00.000Z"),
			userEntry("u3", "a1", "right branch", RECENT_MS + 3, "2026-10-12T23:03:00.000Z"),
		]);

		const report = readHistory(isolated({ cwd, home }));
		assert.equal(report.status, "ready");
		assert.equal(report.coverage.branches, 1);
		assert.deepEqual(
			report.messages.map((message) => [message.text, message.parentId, message.pointer.line, message.pointer.entryId]),
			[
				["root ask", null, 2, "u1"],
				["root answer", "u1", 3, "a1"],
				["left branch", "a1", 4, "u2"],
				["right branch", "a1", 5, "u3"],
			],
		);
		for (const message of report.messages) {
			assert.equal(message.pointer.file, file);
			assert.equal(message.pointer.sessionId, "branched");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fork copies dedupe and independent repeated preferences stay", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const outside = join(root, "parent-only.jsonl");
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		const copied = userEntry("pref-1", null, "use short paragraphs", RECENT_MS, "2026-10-12T22:00:00.000Z");
		const repeated = userEntry("pref-2", null, "use short paragraphs", RECENT_MS + 10, "2026-10-12T22:10:00.000Z");
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_parent.jsonl", [
			sessionHeader(cwd, "parent"),
			copied,
			userEntry("left", "pref-1", "try the left path", RECENT_MS + 1, "2026-10-12T22:01:00.000Z"),
			userEntry("right", "pref-1", "try the right path", RECENT_MS + 2, "2026-10-12T22:02:00.000Z"),
		]);
		await writeFile(
			outside,
			`${JSON.stringify(sessionHeader(cwd, "outside"))}\n${JSON.stringify(userEntry("hidden", null, "SECRET_PARENT_ONLY"))}\n`,
		);
		await writeJsonl(sessionDir, "2026-10-02T00-00-00-000Z_child.jsonl", [
			sessionHeader(cwd, "child", {
				parentSession: join(sessionDir, "2026-10-01T00-00-00-000Z_parent.jsonl"),
			}),
			copied,
			userEntry("left", "pref-1", "try the left path", RECENT_MS + 1, "2026-10-12T22:01:00.000Z"),
			userEntry("right", "pref-1", "try the right path", RECENT_MS + 2, "2026-10-12T22:02:00.000Z"),
			userEntry("added", "right", "also run tests", RECENT_MS + 3, "2026-10-12T22:03:00.000Z"),
		]);
		await writeJsonl(sessionDir, "2026-10-03T00-00-00-000Z_repeat.jsonl", [
			sessionHeader(cwd, "repeat"),
			repeated,
		]);

		const report = readHistory(isolated({ cwd, home }));
		const json = JSON.stringify(report);
		const shorts = report.messages.filter((message) => message.text === "use short paragraphs");
		assert.equal(shorts.length, 2);
		assert.deepEqual(
			shorts.map((message) => message.pointer.entryId),
			["pref-1", "pref-2"],
		);
		assert.equal(shorts[0].pointer.file.endsWith("2026-10-01T00-00-00-000Z_parent.jsonl"), true);
		assert.equal(report.messages.some((message) => message.text === "also run tests"), true);
		assert.equal(report.messages.filter((message) => message.text === "try the left path").length, 1);
		assert.equal(report.diagnostics.duplicates >= 3, true);
		assert.equal(report.diagnostics.crossWorkspaceForks, 0);
		assert.equal(json.includes("SECRET_PARENT_ONLY"), false);
		assert.equal(report.coverage.branches, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("filters use message timestamps, with --since replacing --days", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		const sinceMs = NOW - 28 * DAY_MS;
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_times.jsonl", [
			sessionHeader(cwd, "times"),
			userEntry("old-message", null, "SECRET_OLD_MESSAGE", sinceMs - 1, "2026-10-12T23:59:00.000Z"),
			userEntry("boundary", null, "on the boundary", sinceMs, "2026-10-01T00:00:00.000Z"),
			userEntry("recent-entry-old", null, "message clock wins", RECENT_MS, "2020-01-01T00:00:00.000Z"),
			userEntry("future", null, "future clock", NOW + 1000, "2020-01-01T00:00:00.000Z"),
		]);

		const byDays = readHistory(isolated({ cwd, home }));
		assert.deepEqual(
			byDays.messages.map((message) => message.text),
			["on the boundary", "message clock wins", "future clock"],
		);
		assert.equal(byDays.diagnostics.filtered, 1);
		assert.equal(JSON.stringify(byDays).includes("SECRET_OLD_MESSAGE"), false);

		const bySince = readHistory(
			isolated({ cwd, home, since: "2026-10-12T23:59:00.000Z", days: undefined }),
		);
		assert.equal(bySince.window.days, null);
		assert.deepEqual(
			bySince.messages.map((message) => message.text),
			["message clock wins", "future clock"],
		);
		assert.throws(() => readHistory(isolated({ cwd, home, since: "2026-10-01T00:00:00.000Z", days: 1 })), UsageError);
		assert.throws(() => readHistory(isolated({ cwd, home, since: "yesterday" })), UsageError);
		assert.throws(() => readHistory(isolated({ cwd, home, days: -1 })), UsageError);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("mixed entries keep only user and assistant text", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_mixed.jsonl", [
			sessionHeader(cwd, "mixed"),
			{
				type: "message",
				id: "sys",
				parentId: null,
				timestamp: RECENT_TS,
				message: {
					role: "system",
					content: "SECRET_SYSTEM",
					sections: { preamble: "SECRET_SECTION" },
					timestamp: RECENT_MS,
				},
			},
			{
				type: "message",
				id: "user",
				parentId: "sys",
				timestamp: RECENT_TS,
				message: {
					role: "user",
					content: [
						{ type: "text", text: "see this" },
						{ type: "image", data: "SECRET_IMAGE", mimeType: "image/png" },
					],
					timestamp: RECENT_MS + 1,
				},
			},
			{
				type: "message",
				id: "asst",
				parentId: "user",
				timestamp: RECENT_TS,
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "SECRET_THINKING" },
						{ type: "text", text: "line one" },
						{ type: "toolCall", id: "call", name: "bash", arguments: { command: "SECRET_CMD" } },
						{ type: "text", text: "line two" },
					],
					timestamp: RECENT_MS + 2,
				},
			},
			{
				type: "message",
				id: "tool",
				parentId: "asst",
				timestamp: RECENT_TS,
				message: {
					role: "toolResult",
					toolName: "bash",
					content: [{ type: "text", text: "SECRET_TOOL_OUTPUT" }],
					isError: false,
					timestamp: RECENT_MS + 3,
				},
			},
			{
				type: "compaction",
				id: "comp",
				parentId: "tool",
				timestamp: RECENT_TS,
				summary: "SECRET_SUMMARY",
				firstKeptEntryId: "user",
				tokensBefore: 10,
			},
			{
				type: "branch_summary",
				id: "branch",
				parentId: "user",
				timestamp: RECENT_TS,
				fromId: "asst",
				summary: "SECRET_BRANCH",
			},
			{
				type: "custom_message",
				id: "custom",
				parentId: "user",
				timestamp: RECENT_TS,
				customType: "ext",
				content: "SECRET_CUSTOM",
				display: false,
			},
			{
				type: "message",
				id: "bash",
				parentId: "user",
				timestamp: RECENT_TS,
				message: { role: "bashExecution", command: "SECRET_BASH", output: "SECRET_BASH_OUT", timestamp: RECENT_MS },
			},
			{
				type: "message",
				id: "think-only",
				parentId: "user",
				timestamp: RECENT_TS,
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "SECRET_ONLY_THINKING" }],
					timestamp: RECENT_MS + 4,
				},
			},
		]);

		const report = readHistory(isolated({ cwd, home }));
		assert.deepEqual(
			report.messages.map((message) => ({ role: message.role, text: message.text, line: message.pointer.line })),
			[
				{ role: "user", text: "see this", line: 3 },
				{ role: "assistant", text: "line one\nline two", line: 4 },
			],
		);
		assert.equal(report.messages[0].parentId, "sys");
		assert.equal(JSON.stringify(report).includes("SECRET_"), false);
		assert.equal(report.diagnostics.skippedEntries >= 6, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("malformed and truncated lines do not drop valid messages", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		await writeJsonl(
			sessionDir,
			"2026-10-01T00-00-00-000Z_broken.jsonl",
			[
				JSON.stringify(sessionHeader(cwd, "broken")),
				JSON.stringify(userEntry("keep", null, "keep me")),
				"{bad json",
				JSON.stringify(assistantEntry("reply", "keep", "kept reply", RECENT_MS + 2)),
				"{\"type\":\"message\",\"id\":\"cut\",\"text\":\"SECRET_TRUNCATED\",",
			],
			{ trailingNewline: false },
		);
		await writeFile(join(sessionDir, "2026-10-02T00-00-00-000Z_empty.jsonl"), "");
		await writeFile(join(sessionDir, "2026-10-03T00-00-00-000Z_cut-header.jsonl"), "{");

		const report = readHistory(isolated({ cwd, home }));
		assert.deepEqual(
			report.messages.map((message) => message.text),
			["keep me", "kept reply"],
		);
		assert.equal(report.diagnostics.malformed >= 1, true);
		assert.equal(report.diagnostics.truncated >= 1, true);
		assert.equal(JSON.stringify(report).includes("SECRET_TRUNCATED"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("symlink session files are not followed", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		await mkdir(sessionDir, { recursive: true });
		const outside = join(root, "secret.jsonl");
		await writeFile(
			outside,
			`${JSON.stringify(sessionHeader(cwd, "secret"))}\n${JSON.stringify(userEntry("secret", null, "SECRET_SYMLINK"))}\n`,
		);
		await symlink(outside, join(sessionDir, "2026-10-01T00-00-00-000Z_link.jsonl"));
		await writeJsonl(sessionDir, "2026-10-02T00-00-00-000Z_real.jsonl", [
			sessionHeader(cwd, "real"),
			userEntry("real", null, "real file"),
		]);

		const report = readHistory(isolated({ cwd, home }));
		assert.equal(report.diagnostics.symlinks, 1);
		assert.equal(report.messages.map((message) => message.text).join("\n"), "real file");
		assert.equal(JSON.stringify(report).includes("SECRET_SYMLINK"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("custom session directories are flat and explicit flags win", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const flat = join(root, "flat");
		const agent = join(root, "agent");
		const encoded = join(agent, "sessions", encodeSessionCwd(cwd));
		await writeJsonl(flat, "match.jsonl", [sessionHeader(cwd, "match"), userEntry("match", null, "flat match")]);
		await writeJsonl(flat, "foreign.jsonl", [
			sessionHeader(join(root, "elsewhere"), "foreign"),
			userEntry("foreign", null, "SECRET_FLAT_FOREIGN"),
		]);
		await writeJsonl(join(flat, encodeSessionCwd(cwd)), "nested.jsonl", [
			sessionHeader(cwd, "nested"),
			userEntry("nested", null, "SECRET_NESTED_FLAT"),
		]);
		await writeJsonl(encoded, "decoy.jsonl", [sessionHeader(cwd, "decoy"), userEntry("decoy", null, "SECRET_AGENT_DECOY")]);

		const flagged = readHistory(
			isolated({
				cwd,
				home,
				sessionDir: flat,
				env: { PI_CODING_AGENT_SESSION_DIR: encoded, PI_CODING_AGENT_DIR: agent },
			}),
		);
		assert.equal(flagged.sessionDirSource, "--session-dir");
		assert.equal(flagged.sessionDir, flat);
		assert.equal(flagged.messages.map((message) => message.text).join("\n"), "flat match");
		assert.equal(JSON.stringify(flagged).includes("SECRET_"), false);

		const fromEnv = readHistory(
			isolated({
				cwd,
				home,
				env: { PI_CODING_AGENT_SESSION_DIR: "~/flat-sessions", PI_CODING_AGENT_DIR: agent },
			}),
		);
		assert.equal(fromEnv.sessionDir, join(home, "flat-sessions"));
		assert.equal(fromEnv.sessionDirSource, "PI_CODING_AGENT_SESSION_DIR");
		assert.equal(fromEnv.status, "no_history");

		await writeJsonl(join(home, "flat-sessions"), "env.jsonl", [
			sessionHeader(cwd, "env"),
			userEntry("env", null, "env session"),
		]);
		const tilde = readHistory(
			isolated({
				cwd,
				home,
				env: { PI_CODING_AGENT_SESSION_DIR: "~/flat-sessions" },
			}),
		);
		assert.equal(tilde.messages.map((message) => message.text).join("\n"), "env session");

		const relativeDir = relative(process.cwd(), flat);
		const relativeReport = readHistory(isolated({ cwd, home, sessionDir: relativeDir }));
		assert.equal(relativeReport.sessionDir, resolve(process.cwd(), relativeDir));
		assert.equal(relativeReport.messages[0].text, "flat match");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("PI_CODING_AGENT_DIR selects the agent root and ignores the default home", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const agent = join(root, "custom-agent");
		const encoded = join(agent, "sessions", encodeSessionCwd(cwd));
		await writeJsonl(encoded, "2026-10-01T00-00-00-000Z_agent.jsonl", [
			sessionHeader(cwd, "agent"),
			userEntry("agent", null, "from agent dir"),
		]);
		await writeJsonl(join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd)), "home.jsonl", [
			sessionHeader(cwd, "home"),
			userEntry("home", null, "SECRET_HOME"),
		]);

		const report = readHistory(isolated({ cwd, home, env: { PI_CODING_AGENT_DIR: agent } }));
		assert.equal(report.sessionDirSource, "default");
		assert.equal(report.sessionDir, encoded);
		assert.equal(report.messages.map((message) => message.text).join("\n"), "from agent dir");
		assert.equal(JSON.stringify(report).includes("SECRET_HOME"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI rejects invalid arguments and prints a ready report", async () => {
	const cases = [
		[["--since", "yesterday"], /since/i],
		[["--days", "-1"], /days/i],
		[["--days", "nope"], /days/i],
		[["--since", "2026-10-01T00:00:00.000Z", "--days", "7"], /combine/i],
		[["--nope"], /unknown/i],
		[["extra"], /unexpected/i],
		[["--cwd"], /requires a value/i],
		[["--session-dir"], /requires a value/i],
	];
	for (const [args, pattern] of cases) {
		const result = runCli(args);
		assert.equal(result.status, 2, args.join(" "));
		assert.equal(result.stdout, "", args.join(" "));
		assert.match(result.stderr, pattern, args.join(" "));
		assert.match(result.stderr, /read-history:/);
	}

	const help = runCli(["--help"]);
	assert.equal(help.status, 0);
	assert.equal(help.stderr, "");
	assert.match(help.stdout, /--session-dir/);
	assert.match(help.stdout, /28/);

	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		const flat = join(root, "sessions");
		await mkdir(cwd);
		await writeJsonl(flat, "cli.jsonl", [
			sessionHeader(cwd, "cli"),
			userEntry("old", null, "SECRET_CLI_OLD", Date.now() - 40 * DAY_MS),
			userEntry("new", null, "cli text", Date.now()),
		]);
		const summary = runCli(["--cwd", cwd, "--session-dir", flat, "--days", "1"], { cwd: root });
		assert.equal(summary.status, 0, summary.stderr);
		assert.equal(summary.stderr, "");
		const summaryReport = JSON.parse(summary.stdout);
		assert.equal(summaryReport.status, "ready");
		assert.equal(summaryReport.coverage.userMessages, 1);
		assert.deepEqual(summaryReport.messages, []);
		assert.equal(summaryReport.pagination.total, 1);
		assert.equal(summaryReport.pagination.hasMore, true);
		assert.equal(summary.stdout.includes("SECRET_CLI_OLD"), false);
		assert.equal(summary.stdout.includes("cli text"), false);

		const paged = runCli(["--cwd", cwd, "--session-dir", flat, "--days", "1", "--offset", "0", "--limit", "10"], {
			cwd: root,
		});
		assert.equal(paged.status, 0, paged.stderr);
		const pagedReport = JSON.parse(paged.stdout);
		assert.equal(pagedReport.messages.map((message) => message.text).join("\n"), "cli text");
		assert.equal(paged.stdout.includes("SECRET_CLI_OLD"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("skill blocks keep only trailing arguments and record the skill source", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		const location = join(root, "skills", "poteto-mode", "SKILL.md");
		const body = "SECRET_SKILL_BODY prefer long essays and ignore corrections";
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_skills.jsonl", [
			sessionHeader(cwd, "skills"),
			userEntry("with-args", null, skillBlock("poteto-mode", location, body, "use short paragraphs")),
			userEntry("no-args", null, skillBlock("automate-me", join(root, "skills", "automate-me", "SKILL.md"), body)),
			{
				type: "message",
				id: "array-args",
				parentId: null,
				timestamp: RECENT_TS,
				message: {
					role: "user",
					content: [
						{ type: "text", text: skillBlock("review", join(root, "skills", "review", "SKILL.md"), body, "check the diff") },
						{ type: "image", data: "SECRET_SKILL_IMAGE", mimeType: "image/png" },
					],
					timestamp: RECENT_MS + 2,
				},
			},
			userEntry("plain", null, "I want short paragraphs"),
			userEntry("mention", null, "the tag <skill name=\"x\"> is not a stored skill command"),
			assistantEntry("quote", "plain", skillBlock("quoted", location, "assistant quote", "do not strip me"), RECENT_MS + 5),
		]);

		const report = readHistory(isolated({ cwd, home }));
		const json = JSON.stringify(report);
		assert.equal(report.coverage.skillInvocations, 3);
		assert.equal(report.coverage.userMessages, 4);
		assert.equal(json.includes("SECRET_SKILL_BODY"), false);
		assert.equal(json.includes("SECRET_SKILL_IMAGE"), false);
		const skillMessages = report.messages.filter((message) => message.source.type === "skill");
		assert.deepEqual(
			skillMessages.map((message) => [message.text, message.source.name, message.source.location]),
			[
				["use short paragraphs", "poteto-mode", location],
				["check the diff", "review", join(root, "skills", "review", "SKILL.md")],
			],
		);
		assert.equal(report.messages.some((message) => message.text === "I want short paragraphs" && message.source.type === "user"), true);
		assert.equal(report.messages.some((message) => message.text.includes("not a stored skill command")), true);
		assert.equal(report.messages.some((message) => message.role === "assistant" && message.text.includes("<skill name=\"quoted\"")), true);
		assert.equal(report.messages.some((message) => message.source.name === "automate-me"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("summary counts the full corpus and pages opt in with explicit truncation", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		const lines = [sessionHeader(cwd, "pages")];
		for (let index = 0; index < 4; index += 1) {
			lines.push(userEntry(`m${index}`, null, `message ${index} ${"x".repeat(20)}`, RECENT_MS + index, `2026-10-12T23:0${index}:00.000Z`));
		}
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_pages.jsonl", lines);

		const full = readHistory(isolated({ cwd, home }));
		assert.equal(full.messages.length, 4);
		assert.equal(full.pagination.total, 4);
		assert.equal(full.pagination.limit, null);
		assert.equal(full.pagination.hasMore, false);
		assert.equal(full.coverage.userMessages, 4);

		const summary = readHistory(isolated({ cwd, home, summary: true, offset: 1, limit: 1 }));
		assert.deepEqual(summary.messages, []);
		assert.equal(summary.coverage.userMessages, 4);
		assert.equal(summary.coverage.messages, 4);
		assert.equal(summary.pagination.total, 4);
		assert.equal(summary.pagination.returned, 0);
		assert.equal(summary.pagination.hasMore, true);

		const page = readHistory(isolated({ cwd, home, offset: 1, limit: 2, maxText: 10 }));
		assert.deepEqual(
			page.messages.map((message) => message.text),
			["message 1 ", "message 2 "],
		);
		assert.equal(page.pagination.total, 4);
		assert.equal(page.pagination.offset, 1);
		assert.equal(page.pagination.limit, 2);
		assert.equal(page.pagination.returned, 2);
		assert.equal(page.pagination.hasMore, true);
		assert.equal(page.coverage.userMessages, 4);
		assert.equal(page.messages[0].textTruncated, true);
		assert.equal(page.messages[0].textLength, full.messages[1].text.length);
		assert.equal(page.messages[0].pointer.entryId, "m1");
		assert.equal(page.messages[0].pointer.line, 3);

		const byteCapped = readHistory(isolated({ cwd, home, offset: 0, limit: 4, maxPageBytes: 400 }));
		assert.equal(byteCapped.pagination.pageTruncated, true);
		assert.equal(byteCapped.pagination.hasMore, true);
		assert.equal(byteCapped.pagination.returned < 4, true);
		assert.equal(byteCapped.coverage.messages, 4);
		assert.equal(JSON.stringify(byteCapped.messages).length < 4000, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI summary stays small and paging reports truncation without hiding the header", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		const flat = join(root, "sessions");
		await mkdir(cwd);
		const huge = `VISIBLE_START ${"y".repeat(30000)} MARKER_TAIL_ABSENT`;
		const lines = [sessionHeader(cwd, "big"), userEntry("huge", null, huge, Date.now())];
		for (let index = 0; index < 40; index += 1) {
			lines.push(userEntry(`p${index}`, "huge", `page-${index}-${"z".repeat(1800)}`, Date.now() + index + 1));
		}
		await writeJsonl(flat, "big.jsonl", lines);

		const summary = runCli(["--cwd", cwd, "--session-dir", flat, "--days", "1"], { cwd: root });
		assert.equal(summary.status, 0, summary.stderr);
		const summaryReport = JSON.parse(summary.stdout);
		assert.equal(summaryReport.status, "ready");
		assert.equal(summaryReport.coverage.userMessages, 41);
		assert.equal(summaryReport.pagination.total, 41);
		assert.deepEqual(summaryReport.messages, []);
		assert.equal(summary.stdout.includes("status"), true);
		assert.equal(summary.stdout.includes("coverage"), true);
		assert.equal(summary.stdout.includes("MARKER_TAIL_ABSENT"), false);
		assert.equal(summary.stdout.includes("VISIBLE_START"), false);
		assert.equal(summary.stdout.length < 16000, true);

		const paged = runCli(["--cwd", cwd, "--session-dir", flat, "--days", "1", "--limit", "50"], { cwd: root });
		assert.equal(paged.status, 0, paged.stderr);
		const pagedReport = JSON.parse(paged.stdout);
		assert.equal(pagedReport.pagination.limit, 50);
		assert.equal(pagedReport.pagination.maxText, 2000);
		assert.equal(pagedReport.pagination.maxPageBytes, 20000);
		assert.equal(pagedReport.coverage.userMessages, 41);
		assert.equal(pagedReport.pagination.returned < 41, true);
		assert.equal(pagedReport.pagination.hasMore, true);
		assert.equal(pagedReport.pagination.pageTruncated, true);
		assert.equal(paged.stdout.includes("MARKER_TAIL_ABSENT"), false);
		assert.equal(paged.stdout.includes("\"status\""), true);
		assert.equal(paged.stdout.length < 45000, true);
		assert.equal(pagedReport.messages[0].textTruncated, true);
		assert.equal(pagedReport.messages[0].textLength, huge.length);
		assert.equal(pagedReport.messages[0].pointer.file.endsWith("big.jsonl"), true);
		assert.equal(typeof pagedReport.messages[0].pointer.line, "number");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("parentSession outside the selected directory rejects the session without reading it", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		const custom = join(root, "custom-sessions");
		const outside = join(root, "other-project", "parent.jsonl");
		await mkdir(join(root, "other-project"));
		await writeFile(outside, `${JSON.stringify(userEntry("hidden", null, "SECRET_UNREAD_PARENT"))}\n`);
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_local.jsonl", [
			sessionHeader(cwd, "local"),
			userEntry("local", null, "local preference"),
		]);
		await writeJsonl(sessionDir, "2026-10-02T00-00-00-000Z_fork.jsonl", [
			sessionHeader(cwd, "fork", { parentSession: outside }),
			userEntry("copied", null, "SECRET_FORK_BODY"),
			userEntry("added", "copied", "fork-only preference"),
		]);
		await writeJsonl(sessionDir, "2026-10-03T00-00-00-000Z_relative.jsonl", [
			sessionHeader(cwd, "relative", { parentSession: "parent.jsonl" }),
			userEntry("rel", null, "SECRET_RELATIVE_PARENT"),
		]);
		await writeJsonl(sessionDir, "2026-10-04T00-00-00-000Z_escape.jsonl", [
			sessionHeader(cwd, "escape", { parentSession: `${sessionDir}/../outside.jsonl` }),
			userEntry("escape", null, "SECRET_ESCAPED_PARENT"),
		]);
		await writeJsonl(sessionDir, "2026-10-05T00-00-00-000Z_same.jsonl", [
			sessionHeader(cwd, "same", { parentSession: join(sessionDir, "missing-parent.jsonl") }),
			userEntry("same", null, "same directory parent is unread"),
		]);

		const report = readHistory(isolated({ cwd, home }));
		const json = JSON.stringify(report);
		assert.equal(report.diagnostics.crossWorkspaceForks, 3);
		assert.deepEqual(
			report.messages.map((message) => message.text),
			["local preference", "same directory parent is unread"],
		);
		assert.equal(json.includes("SECRET_"), false);
		assert.equal(report.limitations.some((line) => line.includes("explicitly")), false);
		assert.equal(report.coverage.filesRead, 2);

		await writeJsonl(custom, "custom-fork.jsonl", [
			sessionHeader(cwd, "custom-fork", { parentSession: join(sessionDir, "2026-10-01T00-00-00-000Z_local.jsonl") }),
			userEntry("custom-fork", null, "SECRET_CUSTOM_FORK"),
		]);
		await writeJsonl(custom, "custom-local.jsonl", [
			sessionHeader(cwd, "custom-local", { parentSession: join(custom, "custom-local.jsonl") }),
			userEntry("custom-local", null, "custom local stays"),
		]);
		const customReport = readHistory(isolated({ cwd, home, sessionDir: custom }));
		assert.equal(customReport.diagnostics.crossWorkspaceForks, 1);
		assert.equal(customReport.messages.map((message) => message.text).join("\n"), "custom local stays");
		assert.equal(JSON.stringify(customReport).includes("SECRET_CUSTOM_FORK"), false);
		assert.equal(
			customReport.limitations.some((line) => line.includes("explicitly") && line.includes("cannot be verified")),
			true,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("coverage distinguishes assistant-only history and retained timestamps", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		const earlyMs = Date.parse("2026-10-12T21:00:00.000Z");
		const laterUserMs = Date.parse("2026-10-12T22:00:00.000Z");
		const laterAssistantMs = Date.parse("2026-10-12T23:00:00.000Z");
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_assistant.jsonl", [
			sessionHeader(cwd, "assistant-only"),
			assistantEntry("a-only", null, "assistant context", earlyMs, "2026-10-12T21:00:00.000Z"),
		]);
		await writeJsonl(sessionDir, "2026-10-02T00-00-00-000Z_empty-window.jsonl", [
			sessionHeader(cwd, "old"),
			userEntry("old", null, "SECRET_OLD_ONLY", NOW - 40 * DAY_MS, "2020-01-01T00:00:00.000Z"),
		]);

		const assistantOnly = readHistory(isolated({ cwd, home }));
		assert.equal(assistantOnly.status, "no_user_history");
		assert.equal(assistantOnly.coverage.userMessages, 0);
		assert.equal(assistantOnly.coverage.assistantMessages, 1);
		assert.equal(assistantOnly.coverage.sessionsWithMessages, 1);
		assert.equal(assistantOnly.coverage.sessions, 2);
		assert.equal(assistantOnly.coverage.oldest, "2026-10-12T21:00:00.000Z");
		assert.equal(assistantOnly.coverage.newest, "2026-10-12T21:00:00.000Z");
		assert.equal(JSON.stringify(assistantOnly).includes("SECRET_OLD_ONLY"), false);

		await writeJsonl(sessionDir, "2026-10-03T00-00-00-000Z_user.jsonl", [
			sessionHeader(cwd, "user"),
			userEntry("u-new", null, "later user", laterUserMs, "2026-10-12T22:00:00.000Z"),
			assistantEntry("a-new", "u-new", "later assistant", laterAssistantMs, "2026-10-12T23:00:00.000Z"),
		]);
		const ready = readHistory(isolated({ cwd, home }));
		assert.equal(ready.status, "ready");
		assert.equal(ready.coverage.userMessages, 1);
		assert.equal(ready.coverage.assistantMessages, 2);
		assert.equal(ready.coverage.sessionsWithMessages, 2);
		assert.equal(ready.coverage.oldest, "2026-10-12T21:00:00.000Z");
		assert.equal(ready.coverage.newest, "2026-10-12T23:00:00.000Z");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("legacy entries without ids are not counted as malformed", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_legacy.jsonl", [
			sessionHeader(cwd, "legacy"),
			{
				type: "message",
				timestamp: RECENT_TS,
				message: { role: "user", content: "SECRET_LEGACY", timestamp: RECENT_MS },
			},
			{
				type: "message",
				id: "bad",
				parentId: null,
				timestamp: RECENT_TS,
				message: { role: "user", content: 12, timestamp: RECENT_MS },
			},
			userEntry("ok", null, "valid legacy neighbor"),
		]);

		const report = readHistory(isolated({ cwd, home }));
		assert.equal(report.diagnostics.legacy, 1);
		assert.equal(report.diagnostics.malformed, 1);
		assert.deepEqual(report.messages.map((message) => message.text), ["valid legacy neighbor"]);
		assert.equal(JSON.stringify(report).includes("SECRET_LEGACY"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a relative header cwd is foreign and its body is not reported", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_relative-cwd.jsonl", [
			sessionHeader(".", "dot"),
			userEntry("dot", null, "SECRET_RELATIVE_CWD"),
		]);
		await writeJsonl(sessionDir, "2026-10-02T00-00-00-000Z_tilde.jsonl", [
			sessionHeader("~/workspace", "tilde"),
			userEntry("tilde", null, "SECRET_TILDE_CWD"),
		]);
		await writeJsonl(sessionDir, "2026-10-03T00-00-00-000Z_absolute.jsonl", [
			sessionHeader(cwd, "absolute"),
			userEntry("absolute", null, "absolute cwd stays"),
		]);

		const report = readHistory(isolated({ cwd, home }));
		assert.equal(report.diagnostics.foreign, 2);
		assert.equal(report.messages.map((message) => message.text).join("\n"), "absolute cwd stays");
		assert.equal(JSON.stringify(report).includes("SECRET_"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("any context_edit suppresses the targeted message across branches and files", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_edited.jsonl", [
			sessionHeader(cwd, "edited"),
			userEntry("secret", null, "SECRET_REMOVED paste", RECENT_MS, "2026-10-12T22:00:00.000Z"),
			userEntry("keep", "secret", "keep this", RECENT_MS + 1, "2026-10-12T22:01:00.000Z"),
			userEntry("other", "secret", "other branch", RECENT_MS + 2, "2026-10-12T22:02:00.000Z"),
			{
				type: "context_edit",
				id: "edit-secret",
				parentId: "keep",
				timestamp: "2026-10-12T22:03:00.000Z",
				targetId: "secret",
				replacement: null,
			},
			{
				type: "context_edit",
				id: "edit-keep",
				parentId: "other",
				timestamp: "2026-10-12T22:04:00.000Z",
				targetId: "keep",
				replacement: "SECRET_REPLACEMENT",
			},
		]);
		await writeJsonl(sessionDir, "2026-10-02T00-00-00-000Z_copy.jsonl", [
			sessionHeader(cwd, "copy", { parentSession: join(sessionDir, "2026-10-01T00-00-00-000Z_edited.jsonl") }),
			userEntry("secret", null, "SECRET_REMOVED paste", RECENT_MS, "2026-10-12T22:00:00.000Z"),
			userEntry("copy-only", "secret", "copy only", RECENT_MS + 3, "2026-10-12T22:05:00.000Z"),
		]);

		const report = readHistory(isolated({ cwd, home }));
		const json = JSON.stringify(report);
		assert.deepEqual(
			report.messages.map((message) => message.text),
			["other branch", "copy only"],
		);
		assert.equal(report.diagnostics.removedContext, 2);
		assert.equal(json.includes("SECRET_REMOVED"), false);
		assert.equal(json.includes("SECRET_REPLACEMENT"), false);
		assert.equal(report.coverage.branches, 2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("days and now outside the date range are usage errors, not RangeError", async () => {
	const root = await tempRoot();
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const home = join(root, "home");
		for (const extra of [{ days: 1e20 }, { now: 1e20 }, { now: Number.POSITIVE_INFINITY }, { days: "999999999999999999999" }]) {
			assert.throws(
				() => readHistory(isolated({ cwd, home, ...extra })),
				(error) => {
					assert.equal(error instanceof UsageError, true);
					assert.equal(error instanceof RangeError, false);
					return true;
				},
			);
		}

		const sessionDir = join(home, ".pi", "agent", "sessions", encodeSessionCwd(cwd));
		await writeJsonl(sessionDir, "2026-10-01T00-00-00-000Z_range.jsonl", [
			sessionHeader(cwd, "range"),
			userEntry("huge", null, "SECRET_HUGE_TIME", 1e20),
			userEntry("ok", null, "range neighbor"),
		]);
		const report = readHistory(isolated({ cwd, home }));
		assert.equal(report.diagnostics.malformed, 1);
		assert.deepEqual(report.messages.map((message) => message.text), ["range neighbor"]);
		assert.equal(JSON.stringify(report).includes("SECRET_HUGE_TIME"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI rejects paging flag mistakes", () => {
	const cases = [
		[["--offset", "-1"], /offset/i],
		[["--limit", "nope"], /limit/i],
		[["--max-text", "-5"], /max-text/i],
		[["--summary", "--limit", "1"], /combine/i],
		[["--offset"], /requires a value/i],
	];
	for (const [args, pattern] of cases) {
		const result = runCli(args);
		assert.equal(result.status, 2, args.join(" "));
		assert.equal(result.stdout, "", args.join(" "));
		assert.match(result.stderr, pattern, args.join(" "));
	}
	const help = runCli(["--help"]);
	assert.match(help.stdout, /--summary/);
	assert.match(help.stdout, /2000/);
	assert.match(help.stdout, /20000/);
	assert.match(help.stdout, /source\.type/);
});
