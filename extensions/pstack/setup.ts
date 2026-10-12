import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	applyBudget,
	BUDGETS,
	configPath,
	formatAssignment,
	INHERIT_PARENT,
	makeUpstreamPairConfig,
	readConfig,
	ROLE_SPECS,
	thinkingForBudget,
	type Budget,
	type ModelAssignment,
	type PstackConfig,
	type RoleAssignment,
	type RoleId,
	writeConfig,
} from "./config.ts";

const BUDGET_LABELS: Record<Budget, string> = {
	unlimited: "unlimited — max reasoning",
	large: "large — xhigh reasoning",
	medium: "medium — high reasoning",
	small: "small — medium reasoning",
};

interface ModelChoice {
	slug: string;
	name: string;
}

function availableModels(ctx: ExtensionCommandContext): ModelChoice[] {
	return ctx.modelRegistry
		.getAvailable()
		.map((model: Model<any>) => ({ slug: `${model.provider}/${model.id}`, name: model.name }))
		.sort((a, b) => a.slug.localeCompare(b.slug));
}

function recommendedModel(models: ModelChoice[], id: string, parentProvider?: string): string | undefined {
	const exact = models.filter((model) => model.slug.slice(model.slug.indexOf("/") + 1) === id);
	return exact.find((model) => model.slug.startsWith(`${parentProvider}/`))?.slug ?? exact[0]?.slug;
}

function modelOptions(models: ModelChoice[], recommended?: string): string[] {
	const options = models.map((model) => model.slug);
	if (!recommended || !options.includes(recommended)) return [INHERIT_PARENT, ...options];
	options.splice(options.indexOf(recommended), 1);
	return [recommended, INHERIT_PARENT, ...options];
}

async function selectModel(
	ctx: ExtensionCommandContext,
	title: string,
	models: ModelChoice[],
	recommended?: string,
): Promise<string | undefined> {
	return ctx.ui.select(title, modelOptions(models, recommended));
}

function assignmentFor(model: string, budget: Budget): ModelAssignment {
	return {
		model,
		...(model === INHERIT_PARENT ? {} : { thinking: thinkingForBudget(budget) }),
	};
}

function unavailableModels(config: PstackConfig, models: ModelChoice[]): string[] {
	const available = new Set(models.map((model) => model.slug));
	return [
		...new Set(
			Object.values(config.roles)
				.flatMap((assignment) => (Array.isArray(assignment) ? assignment : assignment ? [assignment] : []))
				.map((assignment) => assignment.model)
				.filter((model) => model !== INHERIT_PARENT && !available.has(model)),
		),
	];
}

function roleSummary(config: PstackConfig): string {
	return ROLE_SPECS.map((role) => `${role.label}: ${formatAssignment(config.roles[role.id])}`).join("\n");
}

async function editPanel(
	ctx: ExtensionCommandContext,
	roleLabel: string,
	models: ModelChoice[],
	budget: Budget,
): Promise<ModelAssignment[] | undefined> {
	const entries: ModelAssignment[] = [];
	while (entries.length < 8) {
		const done = entries.length > 0 ? [`Done (${entries.length} models)`] : [];
		const selected = await ctx.ui.select(
			`${roleLabel}\nChoose models in execution order.`,
			[...done, ...modelOptions(models)],
		);
		if (!selected) return undefined;
		if (selected.startsWith("Done (")) return entries;
		entries.push(assignmentFor(selected, budget));
	}
	return entries;
}

async function customizeConfig(
	ctx: ExtensionCommandContext,
	config: PstackConfig,
	models: ModelChoice[],
): Promise<PstackConfig | undefined> {
	let working = config;
	while (true) {
		const action = await ctx.ui.select(`pstack model routing\n\n${roleSummary(working)}`, [
			"Save configuration",
			"Change one role",
			"Cancel",
		]);
		if (action === "Save configuration") {
			const unavailable = unavailableModels(working, models);
			if (unavailable.length === 0) return working;
			ctx.ui.notify(`Replace unavailable models before saving: ${unavailable.join(", ")}`, "error");
			continue;
		}
		if (!action || action === "Cancel") return undefined;

		const roleLabel = await ctx.ui.select(
			"Choose a role to change",
			ROLE_SPECS.map((role) => role.label),
		);
		if (!roleLabel) continue;
		const role = ROLE_SPECS.find((candidate) => candidate.label === roleLabel)!;
		let assignment: RoleAssignment | undefined;
		if (role.kind === "panel") {
			assignment = await editPanel(ctx, role.label, models, working.budget);
		} else {
			const current = working.roles[role.id];
			const currentModel = current && !Array.isArray(current) ? current.model : undefined;
			const selected = await selectModel(ctx, role.label, models, currentModel);
			if (selected) assignment = assignmentFor(selected, working.budget);
		}
		if (!assignment) continue;
		working = {
			...working,
			roles: { ...working.roles, [role.id as RoleId]: assignment },
		};
	}
}

export async function setupPstack(_args: string, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/setup-pstack requires an interactive or RPC client UI", "error");
		return;
	}

	const models = availableModels(ctx);
	if (models.length === 0) {
		ctx.ui.notify("No authenticated chat models are available. Run /login, then retry /setup-pstack.", "error");
		return;
	}

	const current = readConfig();
	if (current.error) {
		ctx.ui.notify(current.error, "error");
		return;
	}
	if (current.legacy) {
		ctx.ui.notify("Loaded the legacy four-role config. Saving will migrate it to the exact upstream role table.", "warning");
	}

	const currentBudget = current.config?.budget ?? "large";
	const budgetLabel = await ctx.ui.select(
		`Reasoning budget. Current: ${BUDGET_LABELS[currentBudget]}`,
		BUDGETS.map((budget) => BUDGET_LABELS[budget]),
	);
	if (!budgetLabel) return;
	const budget = BUDGETS.find((candidate) => BUDGET_LABELS[candidate] === budgetLabel)!;

	let initial: PstackConfig;
	if (current.config) {
		initial = applyBudget(current.config, budget);
	} else {
		const parentProvider = ctx.model?.provider;
		const fastRecommendation = recommendedModel(models, "grok-4.7", parentProvider);
		const strongRecommendation = recommendedModel(models, "claude-opus-5-5", parentProvider);
		const fast = await selectModel(
			ctx,
			"Fast code model. Upstream default: Grok 4.7.",
			models,
			fastRecommendation,
		);
		if (!fast) return;
		const strong = await selectModel(
			ctx,
			"Judgment model. Upstream default: Claude Opus 5.5.",
			models,
			strongRecommendation,
		);
		if (!strong) return;
		initial = makeUpstreamPairConfig(budget, fast, strong);
	}

	const configured = await customizeConfig(ctx, initial, models);
	if (!configured) return;
	await writeConfig(configured);
	ctx.ui.notify(`Wrote pstack model routing to ${configPath()}`, "info");
}
