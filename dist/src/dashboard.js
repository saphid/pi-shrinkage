import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configPath } from "./config.js";
import { assertNoSymlinkInStorePath, assertNotSymlink, ensurePrivateFileParent } from "./storage.js";
export const DASHBOARD_OUTPUT_PATH = ".pi-shrinkage/dashboard/index.html";
export const DEFAULT_DASHBOARD_MAX_RECORDS = 10_000;
export function readRunLogRecords(path, maxRecords = DEFAULT_DASHBOARD_MAX_RECORDS) {
    assertNoSymlinkInStorePath(path);
    assertNotSymlink(path);
    if (!existsSync(path)) {
        return { records: [], totalLines: 0, parsedLines: 0, skippedLines: 0, truncatedLines: 0, path };
    }
    const text = readFileSync(path, "utf8");
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const truncatedLines = maxRecords > 0 && lines.length > maxRecords ? lines.length - maxRecords : 0;
    const selected = truncatedLines > 0 ? lines.slice(-maxRecords) : lines;
    const records = [];
    let skippedLines = 0;
    for (const line of selected) {
        try {
            const record = sanitizeDashboardRecord(JSON.parse(line));
            if (record)
                records.push(record);
            else
                skippedLines++;
        }
        catch {
            skippedLines++;
        }
    }
    return { records, totalLines: lines.length, parsedLines: records.length, skippedLines, truncatedLines, path };
}
export function writeDashboard(cwd, config, maxRecords = DEFAULT_DASHBOARD_MAX_RECORDS) {
    const logPath = configPath(cwd, config.logFile);
    const outputPath = configPath(cwd, DASHBOARD_OUTPUT_PATH);
    const read = readRunLogRecords(logPath, maxRecords);
    const html = buildDashboardHtml(read.records, {
        generatedAt: new Date().toISOString(),
        logFile: config.logFile,
        maxRecords,
        totalLines: read.totalLines,
        truncatedLines: read.truncatedLines,
        skippedLines: read.skippedLines,
    });
    ensurePrivateFileParent(outputPath);
    writeFileSync(outputPath, html, { encoding: "utf8", mode: 0o600 });
    try {
        chmodSync(outputPath, 0o600);
    }
    catch {
        // Best-effort on platforms/filesystems that do not support POSIX modes.
    }
    return { ...read, outputPath };
}
export function buildDashboardHtml(records, metadata = {}) {
    const template = readFileSync(defaultDashboardTemplatePath(), "utf8");
    const payload = safeJsonForHtml({ records: records.map(sanitizeDashboardRecord).filter(Boolean), metadata });
    return template.replace(/<script id="embedded-data" type="application\/json">[\s\S]*?<\/script>/, `<script id="embedded-data" type="application/json">${payload}</script>`);
}
function sanitizeDashboardRecord(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const record = value;
    if (typeof record.toolName !== "string" || typeof record.action !== "string")
        return undefined;
    const rawTokens = numberOrUndefined(record.rawTokens);
    const finalTokens = numberOrUndefined(record.finalTokens);
    if (rawTokens === undefined || finalTokens === undefined)
        return undefined;
    const out = {
        version: numberOrUndefined(record.version),
        timestamp: stringOrUndefined(record.timestamp),
        sessionId: stringOrUndefined(record.sessionId),
        toolName: record.toolName,
        toolCallId: stringOrUndefined(record.toolCallId),
        command: stringOrUndefined(record.command),
        action: record.action,
        strategy: stringOrUndefined(record.strategy),
        decisionAction: stringOrUndefined(record.decisionAction),
        decisionReason: stringOrUndefined(record.decisionReason),
        changed: booleanOrUndefined(record.changed),
        archived: booleanOrUndefined(record.archived),
        archiveId: stringOrUndefined(record.archiveId),
        rawComplete: booleanOrUndefined(record.rawComplete),
        rawChars: numberOrUndefined(record.rawChars),
        finalChars: numberOrUndefined(record.finalChars),
        rawTokens,
        finalTokens,
        savedTokens: numberOrUndefined(record.savedTokens),
        durationMs: numberOrUndefined(record.durationMs),
    };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}
function defaultDashboardTemplatePath() {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "../../viewer/index.html");
}
function safeJsonForHtml(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}
function stringOrUndefined(value) {
    return typeof value === "string" ? value : undefined;
}
function numberOrUndefined(value) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : undefined;
}
function booleanOrUndefined(value) {
    return typeof value === "boolean" ? value : undefined;
}
