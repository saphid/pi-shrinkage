import { existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ArchiveStore } from "./archive.js";
import { loadConfig, toolEnabled } from "./config.js";
import { writeDashboard } from "./dashboard.js";
import { applyDecision } from "./decision.js";
import { makeTokenCounts, RunLogStore } from "./log.js";
import { decideWithSmallModel, fallbackDecision, shouldAskPolicy } from "./policy.js";
import { reduceDeterministic } from "./rtk.js";
import { commandFromInput, contentFromText, extractText, replaceTextPreservingNonText } from "./text.js";
const stats = { seen: 0, changed: 0, archived: 0, policyCalls: 0, rawChars: 0, finalChars: 0 };
export default function toolResultGovernor(pi) {
    let currentCwd = process.cwd();
    let config = loadConfig(currentCwd);
    let archive = new ArchiveStore(currentCwd, config);
    let runLog = new RunLogStore(currentCwd, config);
    const refresh = (cwd = currentCwd) => {
        currentCwd = cwd;
        config = loadConfig(currentCwd);
        archive = new ArchiveStore(currentCwd, config);
        runLog = new RunLogStore(currentCwd, config);
    };
    pi.on("session_start", async (_event, ctx) => refresh(ctx.cwd));
    pi.on("session_tree", async (_event, ctx) => refresh(ctx.cwd));
    pi.on("tool_result", async (event, ctx) => {
        refresh(ctx.cwd);
        if (!config.enabled)
            return;
        const toolName = String(event.toolName || "unknown");
        if (!toolEnabled(toolName, config))
            return;
        const extracted = extractText(event.content);
        if (!extracted.hadText || extracted.text.length === 0)
            return;
        const metadata = {
            toolName,
            toolCallId: String(event.toolCallId || "unknown"),
            input: event.input,
        };
        const result = await processToolResult(config, archive, metadata, extracted.text, ctx, event.details, ctx.signal, runLog);
        if (!result)
            return;
        return {
            content: replaceTextPreservingNonText(event.content, result.finalText),
            details: {
                ...(event.details && typeof event.details === "object" ? event.details : {}),
                shrinkage: {
                    strategy: result.strategy,
                    decision: result.decision,
                    archiveId: result.archive?.id,
                    rawChars: result.rtk.rawChars,
                    finalChars: result.finalText.length,
                },
            },
        };
    });
    pi.registerTool(defineTool({
        name: "tool_result_fetch",
        label: "Tool Result Fetch",
        description: "Recover raw archived tool output pruned by pi-shrinkage. Use when a reduced/summarized result looks insufficient, suspicious, incomplete, or exact original lines are needed.",
        parameters: Type.Object({
            id: Type.String({ description: "Archive id from a pi-shrinkage retrieval hint" }),
            startLine: Type.Optional(Type.Number({ description: "1-based start line" })),
            endLine: Type.Optional(Type.Number({ description: "1-based inclusive end line" })),
            maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            refresh(ctx.cwd);
            const record = archive.fetch(params.id, {
                startLine: params.startLine,
                endLine: params.endLine,
                maxChars: params.maxChars ?? 30_000,
            });
            if (!record) {
                return { content: contentFromText(`No archived tool result found for id ${params.id}`), details: { found: false } };
            }
            return {
                content: contentFromText(record.rawText),
                details: {
                    found: true,
                    id: record.id,
                    toolName: record.toolName,
                    command: record.command,
                    createdAt: record.createdAt,
                    rawChars: record.rawChars,
                },
            };
        },
    }));
    const statusHandler = async (args, ctx) => {
        refresh(ctx.cwd);
        const command = args.trim().toLowerCase();
        if (["dashboard", "dash", "report", "spa"].includes(command)) {
            try {
                const result = writeDashboard(ctx.cwd, config);
                const lines = [
                    `pi-shrinkage dashboard written:`,
                    result.outputPath,
                    `records=${result.parsedLines}/${result.totalLines} skipped=${result.skippedLines} truncated=${result.truncatedLines}`,
                    `Open that file in a browser. It is a static SPA with embedded usage-log data.`,
                ];
                ctx.ui.notify(lines.join("\n"), "info");
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(`pi-shrinkage dashboard failed: ${message}`, "error");
            }
            return;
        }
        const recent = archive.list(5);
        const saved = Math.max(stats.rawChars - stats.finalChars, 0);
        const lines = [
            `pi-shrinkage: ${config.enabled ? "enabled" : "disabled"}`,
            `seen=${stats.seen} changed=${stats.changed} archived=${stats.archived} policyCalls=${stats.policyCalls}`,
            `chars raw=${stats.rawChars} final=${stats.finalChars} saved≈${saved}`,
            `model=${config.model ?? "none"} fallback=${config.fallback} last=${stats.lastStrategy ?? "none"}`,
            `run log: ${config.logRuns ? config.logFile : "disabled"}`,
            `dashboard: /shrinkage dashboard`,
            `recent archives:`,
            ...recent.map((record) => `- ${record.id} ${record.toolName} ${record.rawChars} chars ${record.command}`),
        ];
        ctx.ui.notify(lines.join("\n"), "info");
    };
    pi.registerCommand("shrinkage", {
        description: "Show pi-shrinkage status. Use /shrinkage dashboard to write the usage-log SPA.",
        handler: statusHandler,
    });
    pi.registerCommand("governor", {
        description: "Alias for /shrinkage",
        handler: statusHandler,
    });
}
export async function processToolResult(config, archive, metadata, rawText, ctx, details, signal, runLog) {
    const startedAt = Date.now();
    stats.seen++;
    const command = commandFromInput(metadata.input);
    const rawSource = resolveCompleteRawText(rawText, details, metadata.toolName);
    const sessionId = sessionIdFromContext(ctx);
    stats.rawChars += rawSource.text.length;
    const logRun = (input) => {
        const tokens = makeTokenCounts(input.rawChars, input.finalChars);
        runLog?.write({
            ...input,
            ...tokens,
            sessionId,
            toolName: metadata.toolName,
            toolCallId: metadata.toolCallId,
            command,
            rawComplete: rawSource.complete,
            durationMs: Date.now() - startedAt,
        });
    };
    if (rawSource.text.length < config.minCharsForRtk) {
        stats.finalChars += rawText.length;
        logRun({ action: "unchanged_below_threshold", changed: false, archived: false, rawChars: rawSource.text.length, finalChars: rawText.length });
        return undefined;
    }
    if (!rawSource.complete && config.archiveRaw) {
        stats.finalChars += rawText.length;
        logRun({ action: "unchanged_incomplete_unarchived", changed: false, archived: false, rawChars: rawSource.text.length, finalChars: rawText.length });
        return undefined;
    }
    if (config.dryRun) {
        stats.finalChars += rawText.length;
        logRun({ action: "dry_run_unchanged", changed: false, archived: false, rawChars: rawSource.text.length, finalChars: rawText.length });
        return undefined;
    }
    const rtk = reduceDeterministic(rawSource.text, { toolName: metadata.toolName, input: metadata.input });
    let decision = fallbackDecision(rawSource.text, rtk.text, config.fallback);
    let strategy = `deterministic:${rtk.strategy}`;
    if (ctx && shouldAskPolicy(config, rawSource.text, rtk.text)) {
        stats.policyCalls++;
        try {
            const policySignal = makeTimeoutSignal(signal, config.policyTimeoutMs);
            const policy = await decideWithSmallModel(config, ctx, { toolName: metadata.toolName, command, rawText: rawSource.text, rtkText: rtk.text, rtkStrategy: rtk.strategy }, policySignal);
            if (policy) {
                decision = policy;
                strategy = `policy:${policy.action}`;
            }
        }
        catch {
            strategy = `${strategy}+policy-failed`;
        }
    }
    const renderFinalText = (archiveHandle) => decision.action === "keep" && rawSource.text !== rawText
        ? `${rawText}\n\n[shrinkage: full raw output was already externalized/truncated and was not re-expanded into active context.${archiveHandle ? ` ${archiveHandle.hint}` : ""}]`
        : applyDecision({ decision, rawText: rawSource.text, rtkText: rtk.text, archive: archiveHandle, maxSummaryChars: config.maxSummaryChars });
    let archiveHandle;
    let finalText = renderFinalText();
    let changed = finalText !== rawText;
    if (changed && config.archiveRaw) {
        try {
            archiveHandle = archive.save({
                toolCallId: metadata.toolCallId,
                toolName: metadata.toolName,
                command,
                rawText: rawSource.text,
                input: metadata.input,
            });
            if (archiveHandle)
                stats.archived++;
        }
        catch {
            stats.finalChars += rawText.length;
            logRun({
                action: "unchanged_archive_failed",
                strategy,
                decisionAction: decision.action,
                decisionReason: decision.reason,
                changed: false,
                archived: false,
                rawChars: rawSource.text.length,
                finalChars: rawText.length,
            });
            return undefined;
        }
        if (!archiveHandle) {
            stats.finalChars += rawText.length;
            logRun({
                action: "unchanged_archive_unavailable",
                strategy,
                decisionAction: decision.action,
                decisionReason: decision.reason,
                changed: false,
                archived: false,
                rawChars: rawSource.text.length,
                finalChars: rawText.length,
            });
            return undefined;
        }
        finalText = renderFinalText(archiveHandle);
        changed = finalText !== rawText;
    }
    stats.finalChars += finalText.length;
    logRun({
        action: changed ? "shrunk" : "unchanged_same_text",
        strategy,
        decisionAction: decision.action,
        decisionReason: decision.reason,
        changed,
        archived: Boolean(archiveHandle),
        archiveId: archiveHandle?.id,
        rawChars: rawSource.text.length,
        finalChars: finalText.length,
    });
    if (!changed)
        return undefined;
    stats.changed++;
    stats.lastStrategy = strategy;
    return { finalText, archive: archiveHandle, rtk, decision, strategy };
}
function sessionIdFromContext(ctx) {
    try {
        return ctx?.sessionManager.getSessionId();
    }
    catch {
        return undefined;
    }
}
function resolveCompleteRawText(displayText, details, toolName) {
    const fullOutputPath = details && typeof details === "object" ? details.fullOutputPath : undefined;
    const candidate = typeof fullOutputPath === "string" ? { path: fullOutputPath, visibleText: undefined } : extractBashFullOutputPath(displayText);
    if (candidate) {
        try {
            if (toolName !== "bash" || !isTrustedBashFullOutputPath(candidate.path))
                return { text: displayText, complete: false };
            if (!existsSync(candidate.path))
                return { text: displayText, complete: false };
            const fullText = readFileSync(candidate.path, "utf8");
            if (candidate.visibleText !== undefined && !visibleTextMatchesFullOutput(candidate.visibleText, fullText)) {
                return { text: displayText, complete: false };
            }
            return { text: fullText, complete: true };
        }
        catch {
            return { text: displayText, complete: false };
        }
    }
    const truncation = details && typeof details === "object" ? details.truncation : undefined;
    if (truncation?.truncated)
        return { text: displayText, complete: false };
    return { text: displayText, complete: true };
}
function extractBashFullOutputPath(displayText) {
    const match = displayText.match(/\n\n\[(Showing (?:lines \d+-\d+ of \d+(?: \([^)]+\))?|last [^\]]+)\. Full output:\s+(\/[^\]\s]+))\]/m);
    if (!match)
        return undefined;
    return { path: match[2], visibleText: displayText.slice(0, match.index).trimEnd() };
}
function visibleTextMatchesFullOutput(visibleText, fullText) {
    const normalizedVisible = visibleText.trim();
    if (normalizedVisible.length < 16)
        return false;
    const probe = normalizedVisible.slice(Math.max(0, normalizedVisible.length - 512));
    return fullText.includes(probe);
}
function isTrustedBashFullOutputPath(path) {
    const real = realpathSync(path);
    const tmp = realpathSync(tmpdir());
    const relativePath = relative(tmp, real);
    return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath) && basename(real).startsWith("pi-bash-") && resolve(real) === real;
}
function makeTimeoutSignal(parent, timeoutMs) {
    if (parent?.aborted)
        return parent;
    if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function")
        return parent;
    const timeout = AbortSignal.timeout(timeoutMs);
    if (!parent)
        return timeout;
    const controller = new AbortController();
    const abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true });
    timeout.addEventListener("abort", abort, { once: true });
    return controller.signal;
}
