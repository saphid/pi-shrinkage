import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
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
export const DEFAULT_CONFIG = {
    enabled: true,
    archiveRaw: true,
    archiveDir: ".pi-shrinkage/archive",
    archivePrivacy: "redact",
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
export function loadConfig(cwd = process.cwd()) {
    const legacyGlobalPath = join(homedir(), ".pi", "agent", "tool-result-governor.json");
    const globalPath = join(homedir(), ".pi", "agent", "pi-shrinkage.json");
    const legacyProjectPath = join(cwd, ".pi", "tool-result-governor.json");
    const projectPath = join(cwd, ".pi", "pi-shrinkage.json");
    const globalConfig = normalizeConfig({
        ...DEFAULT_CONFIG,
        ...readJsonIfPresent(legacyGlobalPath),
        ...readJsonIfPresent(globalPath),
    });
    return normalizeConfig(mergeProjectConfig(globalConfig, {
        ...readJsonIfPresent(legacyProjectPath),
        ...readJsonIfPresent(projectPath),
    }));
}
export function normalizeConfig(input) {
    const merged = { ...DEFAULT_CONFIG, ...input };
    const archivePrivacy = normalizeArchivePrivacy(merged.archivePrivacy);
    return {
        ...merged,
        enabled: merged.enabled !== false,
        archiveRaw: merged.archiveRaw !== false,
        archiveDir: safeStorePath(merged.archiveDir, DEFAULT_CONFIG.archiveDir, "directory"),
        archivePrivacy,
        archiveMaxFiles: nonNegativeInteger(merged.archiveMaxFiles, DEFAULT_CONFIG.archiveMaxFiles),
        archiveMaxAgeDays: nonNegativeInteger(merged.archiveMaxAgeDays, DEFAULT_CONFIG.archiveMaxAgeDays),
        archiveMaxBytes: nonNegativeInteger(merged.archiveMaxBytes, DEFAULT_CONFIG.archiveMaxBytes),
        redactPolicyInput: merged.redactPolicyInput !== false,
        logRuns: merged.logRuns !== false,
        logFile: safeStorePath(merged.logFile, DEFAULT_CONFIG.logFile, "file"),
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
export function configPath(cwd, archiveDir) {
    return resolve(cwd, archiveDir);
}
function mergeProjectConfig(base, project) {
    const merged = { ...base, ...project };
    // Project configs are repo-controlled. Let them make Pi-Shrinkage stricter,
    // but do not let an untrusted checkout weaken user/global privacy choices.
    merged.enabled = base.enabled === false ? false : project.enabled !== false;
    merged.archiveRaw = base.archiveRaw === false ? false : true;
    merged.archivePrivacy = mostPrivateArchivePrivacy(base.archivePrivacy, project.archivePrivacy === undefined ? base.archivePrivacy : normalizeArchivePrivacy(project.archivePrivacy));
    merged.redactPolicyInput = base.redactPolicyInput !== false ? true : project.redactPolicyInput !== true ? false : true;
    merged.logRuns = base.logRuns === false ? false : project.logRuns !== false;
    merged.dryRun = base.dryRun === true ? true : project.dryRun === true;
    // Policy models are a user/global opt-in. A repository must not be able to
    // start sending tool output to a model merely by adding .pi/pi-shrinkage.json.
    merged.model = base.model;
    return merged;
}
export function toolEnabled(toolName, config) {
    return config.tools.some((pattern) => {
        if (toolName === pattern)
            return true;
        if (pattern.endsWith("*"))
            return toolName.startsWith(pattern.slice(0, -1));
        if (pattern.endsWith("__"))
            return toolName.startsWith(pattern);
        return false;
    });
}
export function parseModelRef(ref) {
    if (!ref)
        return undefined;
    const index = ref.indexOf("/");
    if (index <= 0 || index >= ref.length - 1)
        return undefined;
    return { provider: ref.slice(0, index), id: ref.slice(index + 1) };
}
function readJsonIfPresent(path) {
    if (!existsSync(path))
        return {};
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return {};
    }
}
function normalizeArchivePrivacy(value) {
    if (value === "raw" || value === "redact" || value === "off")
        return value;
    return "redact";
}
function mostPrivateArchivePrivacy(a, b) {
    const rank = { raw: 0, redact: 1, off: 2 };
    return rank[b] > rank[a] ? b : a;
}
function safeStorePath(value, fallback, kind) {
    const text = String(value || fallback).trim().replace(/\\/g, "/");
    const parts = text.split("/").filter(Boolean);
    if (!text || isAbsolute(text) || /^[A-Za-z]:\//.test(text) || parts.includes(".."))
        return fallback;
    if (kind === "directory" && (text === ".pi-shrinkage" || text.startsWith(".pi-shrinkage/")))
        return text;
    if (kind === "file" && text.startsWith(".pi-shrinkage/") && parts.length >= 2 && !text.endsWith("/"))
        return text;
    return fallback;
}
function positiveInteger(value, fallback) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
function nonNegativeInteger(value, fallback) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
