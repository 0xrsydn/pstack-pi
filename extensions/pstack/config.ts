import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export const CONFIG_VERSION = 1 as const;
export const CONFIG_FILE_NAME = "pstack-models.json";
export const INHERIT_PARENT = "inherit-parent" as const;

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const BUDGETS = ["unlimited", "large", "medium", "small"] as const;
export type Budget = (typeof BUDGETS)[number];

export const ROLE_SPECS = [
	{ id: "feature-refactoring", label: "feature, refactoring", kind: "single", tier: "fast" },
	{ id: "bug-fix", label: "bug-fix", kind: "single", tier: "fast" },
	{ id: "perf-issue", label: "perf-issue", kind: "single", tier: "fast" },
	{ id: "hillclimb", label: "hillclimb", kind: "single", tier: "fast" },
	{ id: "judgment-prose", label: "judgment and prose", kind: "single", tier: "strong" },
	{ id: "hardest-tasks", label: "hardest tasks", kind: "single", tier: "strong" },
	{ id: "how-explorer", label: "how explorer", kind: "single", tier: "fast" },
	{ id: "how-explainer", label: "how explainer", kind: "single", tier: "strong" },
	{ id: "why-investigators", label: "why investigators", kind: "single", tier: "fast" },
	{ id: "why-synthesizer", label: "why synthesizer", kind: "single", tier: "strong" },
	{ id: "reflect-tooling", label: "reflect tooling", kind: "single", tier: "fast" },
	{
		id: "reflect-judgment-divergent-synthesizer",
		label: "reflect judgment, divergent, synthesizer",
		kind: "single",
		tier: "strong",
	},
	{ id: "arena-runners", label: "arena runners", kind: "panel", tier: "panel" },
	{ id: "arena-cross-judge-pool", label: "arena cross-judge pool", kind: "panel", tier: "panel" },
	{ id: "swarm-workers", label: "swarm workers", kind: "single", tier: "fast" },
	{ id: "architect-runners", label: "architect runners", kind: "panel", tier: "panel" },
	{ id: "interrogate-reviewers", label: "interrogate reviewers", kind: "panel", tier: "panel" },
] as const;

export type RoleSpec = (typeof ROLE_SPECS)[number];
export type RoleId = RoleSpec["id"];
export type RoleKind = RoleSpec["kind"];

const ROLE_IDS = new Set<string>(ROLE_SPECS.map((role) => role.id));
const BUDGET_SET = new Set<string>(BUDGETS);
const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

export interface ModelAssignment {
	model: string;
	thinking?: ThinkingLevel;
}

export type RoleAssignment = ModelAssignment | ModelAssignment[];

export interface PstackConfig {
	version: typeof CONFIG_VERSION;
	budget: Budget;
	roles: Partial<Record<RoleId, RoleAssignment>>;
}

export interface ConfigReadResult {
	config?: PstackConfig;
	error?: string;
	legacy: boolean;
}

export function configPath(): string {
	return path.join(getAgentDir(), CONFIG_FILE_NAME);
}

export function thinkingForBudget(budget: Budget): ThinkingLevel {
	switch (budget) {
		case "unlimited":
			return "max";
		case "large":
			return "xhigh";
		case "medium":
			return "high";
		case "small":
			return "medium";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAssignment(value: unknown, location: string): ModelAssignment {
	if (!isRecord(value)) throw new Error(`${location} must be an object`);
	if (typeof value.model !== "string" || value.model.trim() === "") {
		throw new Error(`${location}.model must be a non-empty string`);
	}
	if (value.thinking !== undefined && !THINKING_LEVEL_SET.has(String(value.thinking))) {
		throw new Error(`${location}.thinking is not a valid Pi thinking level`);
	}
	for (const key of Object.keys(value)) {
		if (key !== "model" && key !== "thinking") throw new Error(`${location}.${key} is not supported`);
	}
	return {
		model: value.model,
		...(value.thinking === undefined ? {} : { thinking: value.thinking as ThinkingLevel }),
	};
}

export function parseConfig(value: unknown): PstackConfig {
	if (!isRecord(value)) throw new Error("config must be an object");
	if (value.version !== CONFIG_VERSION) {
		throw new Error(`config.version must be ${CONFIG_VERSION}`);
	}
	if (typeof value.budget !== "string" || !BUDGET_SET.has(value.budget)) {
		throw new Error(`config.budget must be one of: ${BUDGETS.join(", ")}`);
	}
	if (!isRecord(value.roles)) throw new Error("config.roles must be an object");

	const roles: Partial<Record<RoleId, RoleAssignment>> = {};
	for (const [role, assignment] of Object.entries(value.roles)) {
		if (!ROLE_IDS.has(role)) throw new Error(`unknown role: ${role}`);
		const spec = ROLE_SPECS.find((candidate) => candidate.id === role)!;
		if (spec.kind === "panel") {
			if (!Array.isArray(assignment) || assignment.length === 0) {
				throw new Error(`roles.${role} must be a non-empty array`);
			}
			roles[role as RoleId] = assignment.map((entry, index) =>
				parseAssignment(entry, `roles.${role}[${index}]`),
			);
		} else {
			if (Array.isArray(assignment)) throw new Error(`roles.${role} must be one assignment`);
			roles[role as RoleId] = parseAssignment(assignment, `roles.${role}`);
		}
	}

	for (const key of Object.keys(value)) {
		if (key !== "version" && key !== "budget" && key !== "roles") {
			throw new Error(`config.${key} is not supported`);
		}
	}

	return { version: CONFIG_VERSION, budget: value.budget as Budget, roles };
}

function legacyAssignment(value: unknown, thinking: ThinkingLevel): ModelAssignment | ModelAssignment[] | undefined {
	if (typeof value === "string" && value.trim()) {
		return {
			model: value === "auto" ? INHERIT_PARENT : value,
			...(value === "auto" || value === INHERIT_PARENT ? {} : { thinking }),
		};
	}
	if (Array.isArray(value)) {
		const entries = value
			.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
			.map((model) => ({
				model: model === "auto" ? INHERIT_PARENT : model,
				...(model === "auto" || model === INHERIT_PARENT ? {} : { thinking }),
			}));
		return entries.length > 0 ? entries : undefined;
	}
	return undefined;
}

export function migrateLegacyConfig(value: unknown): PstackConfig | undefined {
	if (!isRecord(value) || value.version !== undefined || value.roles !== undefined) return undefined;
	const budget: Budget = "large";
	const thinking = thinkingForBudget(budget);
	const code = legacyAssignment(value.code, thinking);
	const execution = legacyAssignment(value.execution, thinking);
	const judgment = legacyAssignment(value.judgment, thinking);
	const panel = legacyAssignment(value.panel, thinking);
	if (!code && !execution && !judgment && !panel) return undefined;

	const roles: Partial<Record<RoleId, RoleAssignment>> = {};
	const executionRoles = new Set<RoleId>(["bug-fix", "perf-issue", "hillclimb", "reflect-tooling"]);
	for (const role of ROLE_SPECS) {
		const source =
			role.kind === "panel" ? panel : executionRoles.has(role.id) ? execution : role.tier === "strong" ? judgment : code;
		if (!source) continue;
		if (role.kind === "panel") {
			roles[role.id] = Array.isArray(source) ? source : [source];
		} else {
			roles[role.id] = Array.isArray(source) ? source[0] : source;
		}
	}
	return { version: CONFIG_VERSION, budget, roles };
}

export function readConfig(filePath = configPath()): ConfigReadResult {
	let text: string;
	try {
		text = fs.readFileSync(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { legacy: false };
		return { error: `Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`, legacy: false };
	}

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return { error: `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`, legacy: false };
	}

	try {
		return { config: parseConfig(value), legacy: false };
	} catch (error) {
		const migrated = migrateLegacyConfig(value);
		if (migrated) return { config: migrated, legacy: true };
		return {
			error: `Invalid pstack config in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
			legacy: false,
		};
	}
}

export async function writeConfig(config: PstackConfig, filePath = configPath()): Promise<void> {
	const validated = parseConfig(config);
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	await withFileMutationQueue(filePath, async () => {
		const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
		try {
			await fs.promises.writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
			await fs.promises.rename(temporary, filePath);
		} finally {
			await fs.promises.rm(temporary, { force: true });
		}
	});
}

export function applyBudget(config: PstackConfig, budget: Budget): PstackConfig {
	const thinking = thinkingForBudget(budget);
	const roles: Partial<Record<RoleId, RoleAssignment>> = {};
	for (const role of ROLE_SPECS) {
		const assignment = config.roles[role.id];
		if (!assignment) continue;
		const update = (entry: ModelAssignment): ModelAssignment => ({
			model: entry.model,
			...(entry.model === INHERIT_PARENT ? {} : { thinking }),
		});
		roles[role.id] = Array.isArray(assignment) ? assignment.map(update) : update(assignment);
	}
	return { version: CONFIG_VERSION, budget, roles };
}

export function makeUpstreamPairConfig(
	budget: Budget,
	fastModel: string,
	strongModel: string,
): PstackConfig {
	const thinking = thinkingForBudget(budget);
	const fast: ModelAssignment = {
		model: fastModel,
		...(fastModel === INHERIT_PARENT ? {} : { thinking }),
	};
	const strong: ModelAssignment = {
		model: strongModel,
		...(strongModel === INHERIT_PARENT ? {} : { thinking }),
	};
	const roles: Partial<Record<RoleId, RoleAssignment>> = {};
	for (const role of ROLE_SPECS) {
		if (role.kind === "panel") roles[role.id] = [{ ...strong }, { ...fast }];
		else roles[role.id] = role.tier === "strong" ? { ...strong } : { ...fast };
	}
	return { version: CONFIG_VERSION, budget, roles };
}

export function formatAssignment(assignment: RoleAssignment | undefined): string {
	if (!assignment) return "inherit parent";
	const entries = Array.isArray(assignment) ? assignment : [assignment];
	return entries
		.map((entry) => (entry.model === INHERIT_PARENT ? "inherit parent" : `${entry.model}:${entry.thinking ?? "inherit"}`))
		.join(", ");
}
