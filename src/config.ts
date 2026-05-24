import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type GovernorFallback = "raw" | "rtk";
export type ArchivePrivacy = "raw" | "redact" | "off";

export interface GovernorConfig {
	enabled: boolean;
	archiveRaw: boolean;
	archiveDir: string;
	archivePrivacy: ArchivePrivacy;
	archiveMaxFiles: number;
	archiveMaxAgeDays: number;
	archiveMaxBytes: number;
	redactPolicyInput: boolean;
	logRuns: boolean;
	logFile: string;
	minCharsForModel: number;
	minCharsForRtk: number;
	maxSummaryChars: number;
	model?: string;
	fallback: GovernorFallback;
	tools: string[];
	preserveRecentEditTurns: number;
	policyTimeoutMs: number;
	dryRun: boolean;
}

export const DEFAULT_TOOLS = [
	"bash",
	"read",
	"grep",
	"find",
	"ls",
	"web_search",
	"fetch_content",
	"code_search",
	"mcp__",
];

export const DEFAULT_CONFIG: GovernorConfig = {
	enabled: true,
	archiveRaw: true,
	archiveDir: ".pi-shrinkage/archive",
	archivePrivacy: "raw",
	archiveMaxFiles: 500,
	archiveMaxAgeDays: 30,
	archiveMaxBytes: 100 * 1024 * 1024,
	redactPolicyInput: true,
	logRuns: true,
	logFile: ".pi-shrinkage/runs.jsonl",
	minCharsForModel: 8000,
	minCharsForRtk: 1200,
	maxSummaryChars: 3000,
	fallback: "rtk",
	tools: DEFAULT_TOOLS,
	preserveRecentEditTurns: 4,
	policyTimeoutMs: 45_000,
	dryRun: false,
};

export function loadConfig(cwd = process.cwd()): GovernorConfig {
	const legacyGlobalPath = join(homedir(), ".pi", "agent", "tool-result-governor.json");
	const globalPath = join(homedir(), ".pi", "agent", "pi-shrinkage.json");
	const legacyProjectPath = join(cwd, ".pi", "tool-result-governor.json");
	const projectPath = join(cwd, ".pi", "pi-shrinkage.json");
	return normalizeConfig({
		...DEFAULT_CONFIG,
		...readJsonIfPresent(legacyGlobalPath),
		...readJsonIfPresent(globalPath),
		...readJsonIfPresent(legacyProjectPath),
		...readJsonIfPresent(projectPath),
	});
}

export function normalizeConfig(input: Partial<GovernorConfig>): GovernorConfig {
	const merged = { ...DEFAULT_CONFIG, ...input };
	const archivePrivacy = normalizeArchivePrivacy(merged.archivePrivacy);
	return {
		...merged,
		enabled: merged.enabled !== false,
		archiveRaw: merged.archiveRaw !== false,
		archiveDir: String(merged.archiveDir || DEFAULT_CONFIG.archiveDir),
		archivePrivacy,
		archiveMaxFiles: nonNegativeInteger(merged.archiveMaxFiles, DEFAULT_CONFIG.archiveMaxFiles),
		archiveMaxAgeDays: nonNegativeInteger(merged.archiveMaxAgeDays, DEFAULT_CONFIG.archiveMaxAgeDays),
		archiveMaxBytes: nonNegativeInteger(merged.archiveMaxBytes, DEFAULT_CONFIG.archiveMaxBytes),
		redactPolicyInput: merged.redactPolicyInput !== false,
		logRuns: merged.logRuns !== false,
		logFile: String(merged.logFile || DEFAULT_CONFIG.logFile),
		minCharsForModel: positiveInteger(merged.minCharsForModel, DEFAULT_CONFIG.minCharsForModel),
		minCharsForRtk: positiveInteger(merged.minCharsForRtk, DEFAULT_CONFIG.minCharsForRtk),
		maxSummaryChars: positiveInteger(merged.maxSummaryChars, DEFAULT_CONFIG.maxSummaryChars),
		fallback: merged.fallback === "raw" ? "raw" : "rtk",
		tools: Array.isArray(merged.tools) && merged.tools.length > 0 ? merged.tools.map(String) : DEFAULT_TOOLS,
		preserveRecentEditTurns: positiveInteger(merged.preserveRecentEditTurns, DEFAULT_CONFIG.preserveRecentEditTurns),
		policyTimeoutMs: positiveInteger(merged.policyTimeoutMs, DEFAULT_CONFIG.policyTimeoutMs),
		dryRun: merged.dryRun === true,
	};
}

export function configPath(cwd: string, archiveDir: string): string {
	return resolve(cwd, archiveDir);
}

export function toolEnabled(toolName: string, config: GovernorConfig): boolean {
	return config.tools.some((pattern) => {
		if (toolName === pattern) return true;
		if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
		if (pattern.endsWith("__")) return toolName.startsWith(pattern);
		return false;
	});
}

export function parseModelRef(ref: string | undefined): { provider: string; id: string } | undefined {
	if (!ref) return undefined;
	const index = ref.indexOf("/");
	if (index <= 0 || index >= ref.length - 1) return undefined;
	return { provider: ref.slice(0, index), id: ref.slice(index + 1) };
}

function readJsonIfPresent(path: string): Partial<GovernorConfig> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Partial<GovernorConfig>;
	} catch {
		return {};
	}
}

function normalizeArchivePrivacy(value: unknown): ArchivePrivacy {
	return value === "redact" || value === "off" ? value : "raw";
}

function positiveInteger(value: unknown, fallback: number): number {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
