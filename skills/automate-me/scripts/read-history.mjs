#!/usr/bin/env node

// Read raw user and assistant text from Pi session JSONL for one workspace.
// The header cwd must be absolute and is checked before any message body is read.
// Symlink session files and parentSession paths are not followed.
// A parentSession outside the selected session directory rejects the file.

import { closeSync, constants, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 28;
const CLI_PAGE_LIMIT = 50;
const CLI_MAX_TEXT = 2000;
const CLI_MAX_PAGE_BYTES = 20000;
const MIN_DATE_MS = -8640000000000000;
const MAX_DATE_MS = 8640000000000000;
const MAX_HEADER_BYTES = 1024 * 1024;
const BODY_CHUNK_BYTES = 64 * 1024;
const SINCE_RE =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/;
const SKILL_BLOCK_RE =
	/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;
const KNOWN_OPTIONS = new Set([
	"cwd",
	"sessionDir",
	"since",
	"days",
	"now",
	"env",
	"home",
	"summary",
	"offset",
	"limit",
	"maxText",
	"maxPageBytes",
]);
const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;

export class UsageError extends Error {
	constructor(message) {
		super(message);
		this.name = "UsageError";
	}
}

export function encodeSessionCwd(cwd) {
	return encodeResolvedCwd(resolve(cwd));
}

export function readHistory(options = {}) {
	const settings = resolveSettings(options);
	const diagnostics = emptyDiagnostics();
	const coverage = {
		filesSeen: 0,
		filesRead: 0,
		sessions: 0,
		entries: 0,
		messages: 0,
		branches: 0,
	};
	const state = {
		settings,
		diagnostics,
		coverage,
		messages: [],
		seenMessages: new Set(),
		treeSeen: new Set(),
		treeEntries: [],
		contextTargets: new Set(),
		skillInvocations: 0,
	};

	let dirents;
	try {
		dirents = readdirSync(settings.sessionDir, { withFileTypes: true });
	} catch (error) {
		if (error && error.code === "ENOENT") diagnostics.missing = 1;
		else {
			diagnostics.unreadable = 1;
			diagnostics.skipped = 1;
		}
		return finishReport(state);
	}

	const files = dirents
		.filter((dirent) => dirent.name.endsWith(".jsonl"))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	for (const dirent of files) {
		coverage.filesSeen += 1;
		if (!isDirectChildName(dirent.name)) {
			diagnostics.skipped += 1;
			continue;
		}
		const filePath = resolve(settings.sessionDir, dirent.name);
		if (resolve(filePath, "..") !== settings.sessionDir) {
			diagnostics.skipped += 1;
			continue;
		}
		if (dirent.isSymbolicLink()) {
			diagnostics.symlinks += 1;
			diagnostics.skipped += 1;
			continue;
		}
		if (!dirent.isFile()) {
			diagnostics.unreadable += 1;
			diagnostics.skipped += 1;
			continue;
		}
		inspectFile(filePath, state);
	}

	return finishReport(state);
}

function resolveSettings(options) {
	if (options === null || typeof options !== "object" || Array.isArray(options)) {
		throw new UsageError("options must be an object");
	}
	for (const key of Object.keys(options)) {
		if (!KNOWN_OPTIONS.has(key)) throw new UsageError(`unknown option: ${key}`);
	}
	if (options.since !== undefined && options.days !== undefined) {
		throw new UsageError("do not combine --since and --days");
	}

	const env = options.env ?? process.env;
	if (env === null || typeof env !== "object" || Array.isArray(env)) {
		throw new UsageError("env must be an object");
	}
	const home = options.home === undefined ? homedir() : requireText("home", options.home);
	const base = process.cwd();
	const cwdInput = options.cwd === undefined ? base : requireText("cwd", options.cwd);
	const logical = resolveUserPath(cwdInput, base, home);
	const canonical = canonicalize(logical);
	const now = parseNow(options.now);
	const sinceIso = options.since === undefined ? null : parseSince(options.since);
	const days = sinceIso === null ? (options.days === undefined ? DEFAULT_DAYS : parseDays(options.days)) : null;
	const sinceMs = sinceIso === null ? subtractDays(now, days) : parseSinceMs(sinceIso);
	const location = resolveSessionDir({
		sessionDir: options.sessionDir,
		env,
		home,
		base,
		logical,
	});

	return {
		workspace: canonical,
		logical,
		home,
		sessionDir: location.sessionDir,
		sessionDirSource: location.source,
		sinceMs,
		window: {
			since: toIso(sinceMs),
			days,
		},
		summary: options.summary === undefined ? false : parseBoolean("summary", options.summary),
		offset: options.offset === undefined ? null : parseNonNegativeInt("--offset", options.offset),
		limit: options.limit === undefined ? null : parseNonNegativeInt("--limit", options.limit),
		maxText: options.maxText === undefined ? null : parseNonNegativeInt("--max-text", options.maxText),
		maxPageBytes: options.maxPageBytes === undefined ? null : parseMaxPageBytes(options.maxPageBytes),
	};
}

function resolveSessionDir({ sessionDir, env, home, base, logical }) {
	if (sessionDir !== undefined) {
		return {
			sessionDir: resolveUserPath(requireText("sessionDir", sessionDir), base, home),
			source: "--session-dir",
		};
	}
	const envSessionDir = envText(env, "PI_CODING_AGENT_SESSION_DIR");
	if (envSessionDir) {
		return {
			sessionDir: resolveUserPath(envSessionDir, base, home),
			source: "PI_CODING_AGENT_SESSION_DIR",
		};
	}
	const agentDir = envText(env, "PI_CODING_AGENT_DIR");
	const agentRoot = agentDir ? resolveUserPath(agentDir, base, home) : join(home, ".pi", "agent");
	return {
		sessionDir: join(agentRoot, "sessions", encodeResolvedCwd(logical)),
		source: "default",
	};
}

function inspectFile(filePath, state) {
	let fd;
	try {
		fd = openSync(filePath, constants.O_RDONLY | NO_FOLLOW);
	} catch (error) {
		noteOpenError(error, state.diagnostics);
		return;
	}

	try {
		const headerRead = readHeaderLine(fd);
		const header = acceptHeader(headerRead, state);
		if (!header) return;
		const body = readBody(fd, headerRead.nextOffset);
		state.coverage.filesRead += 1;
		state.coverage.sessions += 1;
		consumeBody(body, filePath, header, state);
	} catch {
		state.diagnostics.unreadable += 1;
		state.diagnostics.skipped += 1;
	} finally {
		closeSync(fd);
	}
}

function acceptHeader(headerRead, state) {
	if (headerRead.capped || headerRead.line.trim() === "") {
		state.diagnostics.malformed += 1;
		state.diagnostics.skipped += 1;
		return null;
	}

	let parsed;
	try {
		parsed = JSON.parse(stripCarriageReturn(headerRead.line));
	} catch {
		if (headerRead.eof) state.diagnostics.truncated += 1;
		else state.diagnostics.malformed += 1;
		state.diagnostics.skipped += 1;
		return null;
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.type !== "session") {
		state.diagnostics.malformed += 1;
		state.diagnostics.skipped += 1;
		return null;
	}
	if (!cwdMatches(parsed.cwd, state.settings)) {
		state.diagnostics.foreign += 1;
		state.diagnostics.skipped += 1;
		return null;
	}
	// Directory match only. Do not open header.parentSession.
	if (!parentSessionAllowed(parsed, state.settings)) {
		state.diagnostics.crossWorkspaceForks += 1;
		state.diagnostics.skipped += 1;
		return null;
	}
	return parsed;
}

function consumeBody(body, filePath, header, state) {
	if (body.length === 0) return;
	const ended = body.endsWith("\n");
	const parts = body.split("\n");
	if (ended) parts.pop();

	for (let index = 0; index < parts.length; index += 1) {
		const raw = stripCarriageReturn(parts[index]);
		const incomplete = !ended && index === parts.length - 1;
		if (raw.trim() === "") continue;
		let entry;
		try {
			entry = JSON.parse(raw);
		} catch {
			if (incomplete) state.diagnostics.truncated += 1;
			else state.diagnostics.malformed += 1;
			continue;
		}
		consumeEntry(entry, filePath, index + 2, header, state);
	}
}

function consumeEntry(entry, filePath, line, header, state) {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		state.diagnostics.malformed += 1;
		return;
	}

	state.coverage.entries += 1;
	rememberTreeEntry(entry, state);
	if (entry.type === "context_edit") {
		if (typeof entry.targetId === "string" && entry.targetId.length > 0) {
			state.contextTargets.add(entry.targetId);
		}
		if (!hasEntryId(entry)) state.diagnostics.legacy += 1;
		else state.diagnostics.skippedEntries += 1;
		return;
	}
	if (!hasEntryId(entry)) {
		state.diagnostics.legacy += 1;
		return;
	}
	if (entry.type !== "message") {
		state.diagnostics.skippedEntries += 1;
		return;
	}

	const extracted = extractText(entry.message);
	if (extracted.kind === "malformed") {
		state.diagnostics.malformed += 1;
		return;
	}
	if (extracted.kind === "skip") {
		state.diagnostics.skippedEntries += 1;
		return;
	}

	const timeMs = messageTimeMs(entry, entry.message);
	if (timeMs === "invalid") {
		state.diagnostics.malformed += 1;
		return;
	}
	if (timeMs === null || timeMs < state.settings.sinceMs) {
		state.diagnostics.filtered += 1;
		return;
	}

	const entryTimestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
	const text = extracted.kind === "skill" ? "" : extracted.text;
	const skillName = extracted.skill ? extracted.skill.name : "";
	const skillLocation = extracted.skill ? extracted.skill.location : "";
	const key = JSON.stringify([entry.id, entryTimestamp, extracted.role, text, skillName, skillLocation]);
	if (state.seenMessages.has(key)) {
		state.diagnostics.duplicates += 1;
		return;
	}
	state.seenMessages.add(key);
	if (extracted.skill) state.skillInvocations += 1;
	if (extracted.kind === "skill") return;

	state.messages.push({
		role: extracted.role,
		text,
		textLength: text.length,
		textTruncated: false,
		source: sourceFor(extracted),
		timestamp: toIso(timeMs),
		parentId: typeof entry.parentId === "string" ? entry.parentId : null,
		pointer: {
			file: filePath,
			line,
			entryId: entry.id,
			sessionId: typeof header.id === "string" ? header.id : null,
		},
	});
}

function rememberTreeEntry(entry, state) {
	if (!hasEntryId(entry)) return;
	const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
	const key = JSON.stringify([entry.id, timestamp]);
	if (state.treeSeen.has(key)) return;
	state.treeSeen.add(key);
	state.treeEntries.push({
		id: entry.id,
		parentId: typeof entry.parentId === "string" ? entry.parentId : null,
	});
}

function extractText(message) {
	if (!message || typeof message !== "object" || Array.isArray(message)) return { kind: "malformed" };
	if (message.role !== "user" && message.role !== "assistant") return { kind: "skip" };

	const content = message.content;
	if (typeof content === "string") return fromTextParts(message.role, [content]);
	if (!Array.isArray(content)) return { kind: "malformed" };

	const parts = [];
	for (const block of content) {
		if (!block || typeof block !== "object" || Array.isArray(block)) return { kind: "malformed" };
		if (block.type !== "text") continue;
		if (typeof block.text !== "string") return { kind: "malformed" };
		if (block.text.length > 0) parts.push(block.text);
	}
	if (parts.length === 0) return { kind: "skip" };
	return fromTextParts(message.role, parts);
}

function fromTextParts(role, parts) {
	const skills = [];
	const kept = [];
	for (const part of parts) {
		const skill = role === "user" ? parseSkillBlock(part) : null;
		if (!skill) {
			kept.push(part);
			continue;
		}
		skills.push(skill);
		if (skill.args.length > 0) kept.push(skill.args);
	}
	const skill = skills[0] ?? null;
	if (kept.length === 0) {
		return skill ? { kind: "skill", role, skill } : { kind: "skip" };
	}
	return { kind: "text", role, text: kept.join("\n"), skill };
}

function parseSkillBlock(text) {
	const match = SKILL_BLOCK_RE.exec(text.replace(/\r\n/g, "\n"));
	if (!match) return null;
	return {
		name: match[1],
		location: match[2],
		args: match[4]?.trim() ?? "",
	};
}

function sourceFor(extracted) {
	if (extracted.skill) {
		return { type: "skill", name: extracted.skill.name, location: extracted.skill.location };
	}
	return { type: extracted.role };
}

function messageTimeMs(entry, message) {
	const raw = message && typeof message === "object" ? message.timestamp : undefined;
	if (typeof raw === "number") {
		if (isDateMs(raw)) return raw;
		return Number.isFinite(raw) ? "invalid" : null;
	}
	if (typeof entry.timestamp === "string") {
		const parsed = Date.parse(entry.timestamp);
		if (!Number.isFinite(parsed)) return null;
		return isDateMs(parsed) ? parsed : "invalid";
	}
	return null;
}

function finishReport(state) {
	const kept = [];
	for (const message of state.messages) {
		if (state.contextTargets.has(message.pointer.entryId)) state.diagnostics.removedContext += 1;
		else kept.push(message);
	}
	kept.sort(compareMessages);
	const page = projectPage(kept, state.settings);
	const userMessages = kept.filter((message) => message.role === "user").length;
	const assistantMessages = kept.filter((message) => message.role === "assistant").length;
	state.coverage.messages = kept.length;
	state.coverage.userMessages = userMessages;
	state.coverage.assistantMessages = assistantMessages;
	state.coverage.sessionsWithMessages = new Set(kept.map((message) => message.pointer.file)).size;
	state.coverage.skillInvocations = state.skillInvocations;
	state.coverage.oldest = kept.length > 0 ? kept[0].timestamp : null;
	state.coverage.newest = kept.length > 0 ? kept[kept.length - 1].timestamp : null;
	state.coverage.branches = countBranches(state.treeEntries);

	let status = "no_history";
	if (userMessages > 0) status = "ready";
	else if (assistantMessages > 0) status = "no_user_history";

	return {
		status,
		workspace: state.settings.workspace,
		sessionDir: state.settings.sessionDir,
		sessionDirSource: state.settings.sessionDirSource,
		window: state.settings.window,
		limitations: reportLimitations(state.settings),
		coverage: state.coverage,
		diagnostics: state.diagnostics,
		pagination: page.pagination,
		messages: page.messages,
	};
}

function projectPage(messages, settings) {
	const total = messages.length;
	if (settings.summary) {
		return {
			messages: [],
			pagination: {
				total,
				offset: 0,
				limit: 0,
				returned: 0,
				hasMore: total > 0,
				maxText: null,
				maxPageBytes: null,
				textTruncated: 0,
				pageTruncated: false,
			},
		};
	}

	const offset = settings.offset ?? 0;
	const limit = settings.limit;
	const end = limit === null ? messages.length : Math.min(messages.length, offset + limit);
	const start = Math.min(offset, messages.length);
	const page = [];
	let usedBytes = 0;
	let pageTruncated = false;
	for (let index = start; index < end; index += 1) {
		const capped = applyMaxText(messages[index], settings.maxText);
		if (settings.maxPageBytes === null) {
			page.push(capped);
			continue;
		}
		if (page.length === 0 && wireBytes(capped) > settings.maxPageBytes) {
			const shrunk = shrinkToBytes(capped, settings.maxPageBytes);
			page.push(shrunk);
			pageTruncated = true;
			usedBytes += wireBytes(shrunk);
			continue;
		}
		const size = wireBytes(capped);
		if (page.length > 0 && usedBytes + size > settings.maxPageBytes) {
			pageTruncated = true;
			break;
		}
		page.push(capped);
		usedBytes += size;
	}

	return {
		messages: page,
		pagination: {
			total,
			offset,
			limit,
			returned: page.length,
			hasMore: offset + page.length < total,
			maxText: settings.maxText,
			maxPageBytes: settings.maxPageBytes,
			textTruncated: page.filter((message) => message.textTruncated).length,
			pageTruncated,
		},
	};
}

function applyMaxText(message, maxText) {
	const textLength = message.text.length;
	if (maxText === null || maxText === 0 || textLength <= maxText) {
		return { ...message, textLength, textTruncated: false };
	}
	return {
		...message,
		text: message.text.slice(0, maxText),
		textLength,
		textTruncated: true,
	};
}

function shrinkToBytes(message, maxPageBytes) {
	const textLength = message.textLength;
	let low = 0;
	let high = message.text.length;
	let best = "";
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const text = message.text.slice(0, mid);
		const trial = { ...message, text, textLength, textTruncated: text.length < textLength };
		if (wireBytes(trial) <= maxPageBytes) {
			best = text;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return {
		...message,
		text: best,
		textLength,
		textTruncated: best.length < textLength,
	};
}

function wireBytes(message) {
	const pretty = JSON.stringify(message, null, 2);
	let size = 1;
	for (const line of pretty.split("\n")) size += line.length + 3;
	return size;
}

function reportLimitations(settings) {
	const lines = [
		"parentSession paths are not opened. A session is rejected when parentSession is present and its directory does not match the selected session directory.",
	];
	if (settings.sessionDirSource !== "default") {
		lines.push(
			"This session directory was set explicitly. A parentSession in another directory, including the default encoded directory, cannot be verified and is rejected.",
		);
	}
	return lines;
}

function countBranches(entries) {
	const childCount = new Map();
	for (const entry of entries) {
		if (typeof entry.parentId !== "string" || entry.parentId.length === 0) continue;
		childCount.set(entry.parentId, (childCount.get(entry.parentId) ?? 0) + 1);
	}
	let branches = 0;
	for (const count of childCount.values()) {
		if (count > 1) branches += count - 1;
	}
	return branches;
}

function compareMessages(left, right) {
	if (left.timestamp < right.timestamp) return -1;
	if (left.timestamp > right.timestamp) return 1;
	if (left.pointer.file < right.pointer.file) return -1;
	if (left.pointer.file > right.pointer.file) return 1;
	if (left.pointer.line !== right.pointer.line) return left.pointer.line - right.pointer.line;
	if (left.pointer.entryId < right.pointer.entryId) return -1;
	if (left.pointer.entryId > right.pointer.entryId) return 1;
	if (left.role < right.role) return -1;
	if (left.role > right.role) return 1;
	return 0;
}

function cwdMatches(headerCwd, settings) {
	if (typeof headerCwd !== "string" || !isAbsolute(headerCwd)) return false;
	const logical = resolve(headerCwd);
	if (logical === settings.logical) return true;
	return canonicalize(logical) === settings.workspace;
}

function parentSessionAllowed(header, settings) {
	if (!Object.hasOwn(header, "parentSession") || header.parentSession === null) return true;
	const value = header.parentSession;
	if (typeof value !== "string" || !isAbsolute(value)) return false;
	return sameDirectory(dirname(resolve(value)), settings.sessionDir);
}

function sameDirectory(left, right) {
	if (left === right) return true;
	try {
		return realpathSync(left) === realpathSync(right);
	} catch {
		return false;
	}
}

function canonicalize(logical) {
	try {
		return realpathSync(logical);
	} catch {
		return logical;
	}
}

function encodeResolvedCwd(resolvedCwd) {
	return `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function resolveUserPath(input, base, home) {
	return resolve(base, expandTilde(input, home));
}

function expandTilde(input, home) {
	if (input === "~") return home;
	if (input.startsWith("~/")) return join(home, input.slice(2));
	return input;
}

function envText(env, name) {
	const value = env[name];
	if (typeof value !== "string" || value.trim() === "") return undefined;
	return value.trim();
}

function requireText(name, value) {
	if (typeof value !== "string" || value.trim() === "") {
		throw new UsageError(`${name} must be a non-empty string`);
	}
	return value;
}

function parseNow(value) {
	if (value === undefined) return Date.now();
	if (!isDateMs(value)) {
		throw new UsageError("now must be a finite epoch millisecond inside the date range");
	}
	return value;
}

function parseDays(value) {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) {
		const days = Number(value.trim());
		if (Number.isFinite(days) && days >= 0) return days;
	}
	throw new UsageError(`invalid --days value: ${preview(value)}`);
}

function subtractDays(now, days) {
	const sinceMs = now - days * DAY_MS;
	if (!isDateMs(sinceMs)) throw new UsageError(`invalid --days value: ${preview(days)}`);
	return sinceMs;
}

function parseSince(value) {
	if (typeof value !== "string" || !SINCE_RE.test(value.trim())) {
		throw new UsageError(`invalid --since value: ${preview(value)}`);
	}
	const ms = Date.parse(value.trim());
	if (!isDateMs(ms)) throw new UsageError(`invalid --since value: ${preview(value)}`);
	return toIso(ms);
}

function parseSinceMs(iso) {
	const ms = Date.parse(iso);
	if (!isDateMs(ms)) throw new UsageError(`invalid --since value: ${preview(iso)}`);
	return ms;
}

function parseBoolean(name, value) {
	if (typeof value !== "boolean") throw new UsageError(`${name} must be a boolean`);
	return value;
}

function parseNonNegativeInt(flag, value) {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/.test(value.trim())) {
		const parsed = Number(value.trim());
		if (Number.isSafeInteger(parsed)) return parsed;
	}
	throw new UsageError(`invalid ${flag} value: ${preview(value)}`);
}

function parseMaxPageBytes(value) {
	const parsed = parseNonNegativeInt("--max-page-bytes", value);
	if (parsed < 1) throw new UsageError("maxPageBytes must be a positive integer");
	return parsed;
}

function isDateMs(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= MIN_DATE_MS && value <= MAX_DATE_MS;
}

function toIso(ms) {
	if (!isDateMs(ms)) throw new UsageError("timestamp is outside the date range");
	return new Date(ms).toISOString();
}

function preview(value) {
	const text = String(value);
	return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function hasEntryId(entry) {
	return typeof entry.id === "string" && entry.id.length > 0;
}

function emptyDiagnostics() {
	return {
		missing: 0,
		skipped: 0,
		skippedEntries: 0,
		malformed: 0,
		truncated: 0,
		foreign: 0,
		symlinks: 0,
		unreadable: 0,
		filtered: 0,
		duplicates: 0,
		legacy: 0,
		crossWorkspaceForks: 0,
		removedContext: 0,
	};
}

function noteOpenError(error, diagnostics) {
	if (error && (error.code === "ELOOP" || error.code === "EMLINK")) diagnostics.symlinks += 1;
	else diagnostics.unreadable += 1;
	diagnostics.skipped += 1;
}

function isDirectChildName(name) {
	return name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\");
}

function stripCarriageReturn(line) {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// Read one byte at a time so a rejected header never pulls message bytes into user space.
function readHeaderLine(fd) {
	const bytes = [];
	const one = Buffer.alloc(1);
	let offset = 0;
	while (offset < MAX_HEADER_BYTES) {
		const n = readSync(fd, one, 0, 1, offset);
		if (n === 0) {
			return { line: Buffer.from(bytes).toString("utf8"), nextOffset: offset, eof: true, capped: false };
		}
		offset += 1;
		if (one[0] === 0x0a) {
			return { line: Buffer.from(bytes).toString("utf8"), nextOffset: offset, eof: false, capped: false };
		}
		bytes.push(one[0]);
	}
	return { line: "", nextOffset: offset, eof: false, capped: true };
}

function readBody(fd, start) {
	const chunks = [];
	const buf = Buffer.alloc(BODY_CHUNK_BYTES);
	let offset = start;
	for (;;) {
		const n = readSync(fd, buf, 0, buf.length, offset);
		if (n === 0) break;
		chunks.push(Buffer.from(buf.subarray(0, n)));
		offset += n;
	}
	if (chunks.length === 0) return "";
	return Buffer.concat(chunks).toString("utf8");
}

function usageText() {
	return [
		"Usage: node read-history.mjs [--cwd <path>] [--session-dir <dir>] [--since <iso>] [--days <n>] [--summary] [--offset <n>] [--limit <n>] [--max-text <n>]",
		"",
		"Read user and assistant text from Pi session files for one workspace.",
		"",
		"--cwd <path>          Workspace path. Default is the current directory.",
		"--session-dir <dir>   Read this flat directory instead of the encoded workspace directory.",
		"--since <iso>         Keep messages at or after this ISO-8601 timestamp.",
		"--days <n>            Keep messages from the last n days. Default is 28.",
		"                      Do not pass --since and --days together.",
		"--summary             Omit messages. This is the default unless --offset, --limit, or --max-text is set.",
		"--offset <n>          Start the message page at this zero-based index. Default is 0.",
		"--limit <n>           Maximum messages in the page. Default is 50 when paging.",
		"--max-text <n>        Maximum characters kept in each paged message. Default is 2000. 0 keeps the full text.",
		"                      Each truncated message sets textTruncated and textLength. Read pointer.file at pointer.line for the full text.",
		"                      Paged output is also capped at 20000 bytes. pagination.pageTruncated reports that cap.",
		"",
		"The session directory is --session-dir, otherwise PI_CODING_AGENT_SESSION_DIR,",
		"otherwise <agent>/sessions/--encoded-cwd--. The agent root is PI_CODING_AGENT_DIR",
		"or ~/.pi/agent.",
		"",
		"A Pi skill command is stored as a <skill> block plus trailing arguments.",
		"The report keeps only those arguments and sets source.type to \"skill\".",
		"The skill body is not user evidence.",
		"",
		"A parentSession outside the selected session directory is rejected and not opened.",
		"An explicit session directory cannot verify a parentSession in another directory.",
		"",
		"The command prints a JSON report on stdout. Invalid arguments exit 2.",
	].join("\n");
}

function parseArgs(argv) {
	const flags = new Map([
		["--cwd", "cwd"],
		["--session-dir", "sessionDir"],
		["--since", "since"],
		["--days", "days"],
		["--offset", "offset"],
		["--limit", "limit"],
		["--max-text", "maxText"],
	]);
	const boolFlags = new Map([["--summary", "summary"]]);
	const out = {};
	const seen = new Set();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			out.help = true;
			continue;
		}
		const eq = arg.indexOf("=");
		const flag = eq === -1 ? arg : arg.slice(0, eq);
		const inline = eq === -1 ? undefined : arg.slice(eq + 1);
		const boolKey = boolFlags.get(flag);
		if (boolKey) {
			if (inline !== undefined) throw new UsageError(`${flag} does not take a value`);
			if (seen.has(boolKey)) throw new UsageError(`duplicate argument: ${flag}`);
			seen.add(boolKey);
			out[boolKey] = true;
			continue;
		}
		const key = flags.get(flag);
		if (!key) {
			if (flag.startsWith("-")) throw new UsageError(`unknown argument: ${preview(flag)}`);
			throw new UsageError(`unexpected argument: ${preview(arg)}`);
		}
		if (seen.has(key)) throw new UsageError(`duplicate argument: ${flag}`);
		seen.add(key);
		const value = inline !== undefined ? inline : argv[index + 1];
		if (value === undefined || flags.has(value) || boolFlags.has(value) || value === "--help" || value === "-h") {
			throw new UsageError(`${flag} requires a value`);
		}
		if (inline === undefined) index += 1;
		out[key] = value;
	}
	return out;
}

function cliOptions(args) {
	if (args.summary && (args.offset !== undefined || args.limit !== undefined || args.maxText !== undefined)) {
		throw new UsageError("do not combine --summary with --offset, --limit, or --max-text");
	}
	const options = {};
	if (args.cwd !== undefined) options.cwd = args.cwd;
	if (args.sessionDir !== undefined) options.sessionDir = args.sessionDir;
	if (args.since !== undefined) options.since = args.since;
	if (args.days !== undefined) options.days = args.days;
	const paging = args.offset !== undefined || args.limit !== undefined || args.maxText !== undefined;
	if (args.summary || !paging) {
		options.summary = true;
		return options;
	}
	options.offset = args.offset === undefined ? 0 : args.offset;
	options.limit = args.limit === undefined ? CLI_PAGE_LIMIT : args.limit;
	options.maxText = args.maxText === undefined ? CLI_MAX_TEXT : args.maxText;
	options.maxPageBytes = CLI_MAX_PAGE_BYTES;
	return options;
}

function invokedDirectly() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return pathToFileURL(realpathSync(entry)).href === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
	} catch {
		return import.meta.url === pathToFileURL(entry).href;
	}
}

function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`read-history: ${message}\n${usageText()}\n`);
		process.exit(2);
	}
	if (args.help) {
		process.stdout.write(`${usageText()}\n`);
		return;
	}
	try {
		const report = readHistory(cliOptions(args));
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} catch (error) {
		if (error instanceof UsageError) {
			process.stderr.write(`read-history: ${error.message}\n${usageText()}\n`);
			process.exit(2);
		}
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`read-history: ${message}\n`);
		process.exit(1);
	}
}

if (invokedDirectly()) main();
