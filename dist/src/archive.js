import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { configPath } from "./config.js";
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
        if (!this.config.archiveRaw)
            return undefined;
        const id = makeArchiveId(record.toolCallId, record.toolName, record.rawText);
        const fullRecord = {
            ...record,
            id,
            createdAt: new Date().toISOString(),
            rawChars: record.rawText.length,
        };
        const dir = configPath(this.cwd, this.config.archiveDir);
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${id}.json`);
        writeFileSync(path, JSON.stringify(fullRecord, null, 2));
        this.records.set(id, fullRecord);
        return {
            id,
            path,
            hint: `Full raw output archived as ${id}. If this reduction is insufficient, suspicious, or missing exact lines, call tool_result_fetch({ id: "${id}" }) to recover the raw result; use startLine/endLine/maxChars for a smaller slice.`,
        };
    }
    fetch(id, options = {}) {
        const normalized = sanitizeId(id);
        const memory = this.records.get(normalized);
        if (memory)
            return sliceRecord(memory, options);
        const path = resolve(configPath(this.cwd, this.config.archiveDir), `${normalized}.json`);
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
        return readdirSync(dir)
            .filter((file) => file.endsWith(".json"))
            .flatMap((file) => {
            try {
                const record = JSON.parse(readFileSync(join(dir, file), "utf8"));
                return [record];
            }
            catch {
                return [];
            }
        })
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .slice(0, limit);
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
function sliceRecord(record, options) {
    const sliced = lineSlice(record.rawText, options.startLine, options.endLine);
    return {
        ...record,
        rawText: truncateChars(sliced, options.maxChars ?? sliced.length),
    };
}
