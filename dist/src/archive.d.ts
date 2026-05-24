import type { GovernorConfig } from "./config.js";
export interface ArchiveRecord {
    id: string;
    toolCallId: string;
    toolName: string;
    command: string;
    createdAt: string;
    rawChars: number;
    finalChars?: number;
    rawText: string;
    originalChars?: number;
    redacted?: boolean;
    redactionCount?: number;
    input?: unknown;
}
export interface ArchiveHandle {
    id: string;
    path: string;
    hint: string;
}
export declare class ArchiveStore {
    private readonly cwd;
    private readonly config;
    private readonly records;
    constructor(cwd: string, config: GovernorConfig);
    save(record: Omit<ArchiveRecord, "id" | "createdAt" | "rawChars">): ArchiveHandle | undefined;
    fetch(id: string, options?: {
        startLine?: number;
        endLine?: number;
        maxChars?: number;
    }): ArchiveRecord | undefined;
    list(limit?: number): ArchiveRecord[];
    private enforceRetention;
}
export declare function makeArchiveId(toolCallId: string, toolName: string, rawText: string): string;
