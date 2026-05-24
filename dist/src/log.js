import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { configPath } from "./config.js";
import { redactLikelySecrets } from "./redact.js";
import { truncateChars } from "./text.js";
export class RunLogStore {
    cwd;
    config;
    constructor(cwd, config) {
        this.cwd = cwd;
        this.config = config;
    }
    write(record) {
        if (!this.config.logRuns)
            return;
        try {
            const path = configPath(this.cwd, this.config.logFile);
            mkdirSync(dirname(path), { recursive: true });
            const command = record.command ? truncateChars(redactLikelySecrets(record.command).text, 500) : undefined;
            const decisionReason = record.decisionReason ? truncateChars(redactLikelySecrets(record.decisionReason).text, 500) : undefined;
            const line = JSON.stringify({ version: 1, ...record, timestamp: record.timestamp ?? new Date().toISOString(), command, decisionReason });
            appendFileSync(path, `${line}\n`, "utf8");
        }
        catch {
            // Logging must never affect tool-result handling.
        }
    }
}
export function estimateTextTokensFromChars(chars) {
    return Math.ceil(Math.max(chars, 0) / 4);
}
export function makeTokenCounts(rawChars, finalChars) {
    const rawTokens = estimateTextTokensFromChars(rawChars);
    const finalTokens = estimateTextTokensFromChars(finalChars);
    return { rawTokens, finalTokens, savedTokens: Math.max(rawTokens - finalTokens, 0) };
}
