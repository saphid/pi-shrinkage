import { appendFileSync, chmodSync } from "node:fs";
import { configPath } from "./config.js";
import { redactLikelySecrets } from "./redact.js";
import { ensurePrivateFileParent } from "./storage.js";
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
            ensurePrivateFileParent(path);
            const command = record.command ? truncateChars(redactLikelySecrets(record.command).text, 500) : undefined;
            const decisionReason = record.decisionReason ? truncateChars(redactLikelySecrets(record.decisionReason).text, 500) : undefined;
            const line = JSON.stringify({ version: 1, ...record, timestamp: record.timestamp ?? new Date().toISOString(), command, decisionReason });
            appendFileSync(path, `${line}\n`, { encoding: "utf8", mode: 0o600 });
            try {
                chmodSync(path, 0o600);
            }
            catch {
                // Best-effort on platforms/filesystems that do not support POSIX modes.
            }
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
