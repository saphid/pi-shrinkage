import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { configPath } from "./config.js";
import { redactLikelySecrets, redactLikelySecretsInValue } from "./redact.js";
import { lineSlice, truncateChars } from "./text.js";
export class ArchiveStore {
    cwd;
    config;
    records = new Map();
    constructor(cwd, config) {
        this.cwd = cwd;
        this.config = config;
    }
    save(record) {
        if (!this.config.archiveRaw || this.config.archivePrivacy === "off")
            return undefined;
        const shouldRedact = this.config.archivePrivacy === "redact";
        const textRedaction = shouldRedact ? redactLikelySecrets(record.rawText) : undefined;
        const commandRedaction = shouldRedact ? redactLikelySecrets(record.command) : undefined;
        const inputRedaction = shouldRedact ? redactLikelySecretsInValue(record.input) : undefined;
        const archivedText = textRedaction?.text ?? record.rawText;
        const id = makeArchiveId(record.toolCallId, record.toolName, record.rawText);
        const fullRecord = {
            ...record,
            command: commandRedaction?.text ?? record.command,
            input: inputRedaction?.value ?? record.input,
            rawText: archivedText,
            id,
            createdAt: new Date().toISOString(),
            rawChars: archivedText.length,
            originalChars: record.rawText.length,
            redacted: shouldRedact,
            redactionCount: (textRedaction?.count ?? 0) + (commandRedaction?.count ?? 0) + (inputRedaction?.count ?? 0),
        };
        const dir = configPath(this.cwd, this.config.archiveDir);
        mkdirSync(dir, { recursive: true });
        try {
            this.enforceRetention(dir);
        }
        catch {
            // Retention cleanup must not prevent fresh archive writes.
        }
        const path = join(dir, `${id}.json`);
        writeFileSync(path, JSON.stringify(fullRecord, null, 2));
        this.records.set(id, fullRecord);
        try {
            this.enforceRetention(dir, `${id}.json`);
        }
        catch {
            // Best-effort cleanup only.
        }
        if (!existsSync(path))
            throw new Error(`Archive retention removed fresh archive ${id}`);
        const archivedKind = fullRecord.redacted ? "Redacted raw output" : "Full raw output";
        const recovery = fullRecord.redacted ? "recover the redacted archived result" : "recover the raw result";
        return {
            id,
            path,
            hint: `${archivedKind} archived as ${id}. If this reduction is insufficient, suspicious, or missing exact lines, call tool_result_fetch({ id: "${id}" }) to ${recovery}; use startLine/endLine/maxChars for a smaller slice.`,
        };
    }
    fetch(id, options = {}) {
        const normalized = sanitizeId(id);
        const dir = configPath(this.cwd, this.config.archiveDir);
        try {
            if (existsSync(dir))
                this.enforceRetention(dir);
        }
        catch {
            // Fetch remains best-effort if retention cleanup fails.
        }
        const path = resolve(dir, `${normalized}.json`);
        const memory = this.records.get(normalized);
        if (memory && existsSync(path))
            return sliceRecord(memory, options);
        if (memory && !existsSync(path))
            this.records.delete(normalized);
        if (!existsSync(path))
            return undefined;
        try {
            const record = JSON.parse(readFileSync(path, "utf8"));
            this.records.set(record.id, record);
            return sliceRecord(record, options);
        }
        catch {
            return undefined;
        }
    }
    list(limit = 20) {
        const dir = configPath(this.cwd, this.config.archiveDir);
        if (!existsSync(dir))
            return [];
        try {
            this.enforceRetention(dir);
        }
        catch {
            // Listing should remain best-effort even if cleanup fails.
        }
        return readdirSync(dir)
            .filter((file) => file.endsWith(".json"))
            .flatMap((file) => {
            try {
                const record = JSON.parse(readFileSync(join(dir, file), "utf8"));
                return isArchiveRecordFile(record, file) ? [record] : [];
            }
            catch {
                return [];
            }
        })
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .slice(0, limit);
    }
    enforceRetention(dir, preferredFile) {
        const maxFiles = this.config.archiveMaxFiles;
        const maxBytes = this.config.archiveMaxBytes;
        const maxAgeDays = this.config.archiveMaxAgeDays;
        if (maxFiles === 0 && maxBytes === 0 && maxAgeDays === 0)
            return;
        const now = Date.now();
        const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : 0;
        const entries = readdirSync(dir)
            .filter((file) => file.endsWith(".json"))
            .flatMap((file) => {
            const path = join(dir, file);
            try {
                const record = JSON.parse(readFileSync(path, "utf8"));
                if (!isArchiveRecordFile(record, file))
                    return [];
                const stat = statSync(path);
                const parsed = Date.parse(record.createdAt);
                const createdAt = Number.isFinite(parsed) ? parsed : stat.mtimeMs;
                return [{ file, path, size: stat.size, createdAt, mtimeMs: stat.mtimeMs }];
            }
            catch {
                return [];
            }
        })
            .sort((a, b) => {
            if (preferredFile && a.file === preferredFile && b.file !== preferredFile)
                return -1;
            if (preferredFile && b.file === preferredFile && a.file !== preferredFile)
                return 1;
            return b.createdAt - a.createdAt || b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file);
        });
        let keptFiles = 0;
        let keptBytes = 0;
        for (const entry of entries) {
            const tooOld = maxAgeMs > 0 && now - entry.createdAt > maxAgeMs;
            const tooMany = maxFiles > 0 && keptFiles >= maxFiles;
            const tooLarge = maxBytes > 0 && keptBytes + entry.size > maxBytes;
            if (tooOld || tooMany || tooLarge) {
                try {
                    unlinkSync(entry.path);
                    this.records.delete(basename(entry.file, ".json"));
                }
                catch {
                    // Ignore individual retention deletion failures.
                }
                continue;
            }
            keptFiles++;
            keptBytes += entry.size;
        }
    }
}
export function makeArchiveId(toolCallId, toolName, rawText) {
    const base = sanitizeId(toolCallId || toolName || "tool-result").slice(0, 60);
    const hash = createHash("sha256").update(`${toolCallId}\n${toolName}\n${rawText}`).digest("hex").slice(0, 10);
    return `${base || "tool-result"}-${hash}`;
}
function sanitizeId(id) {
    return basename(id).replace(/[^a-zA-Z0-9_.-]/g, "_");
}
function isArchiveRecordFile(record, file) {
    return (typeof record.id === "string" &&
        `${sanitizeId(record.id)}.json` === file &&
        typeof record.toolCallId === "string" &&
        typeof record.toolName === "string" &&
        typeof record.command === "string" &&
        typeof record.createdAt === "string" &&
        typeof record.rawChars === "number" &&
        typeof record.rawText === "string");
}
function sliceRecord(record, options) {
    const sliced = lineSlice(record.rawText, options.startLine, options.endLine);
    return {
        ...record,
        rawText: truncateChars(sliced, options.maxChars ?? sliced.length),
    };
}
