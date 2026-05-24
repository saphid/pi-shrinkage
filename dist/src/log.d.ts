import type { GovernorConfig } from "./config.js";
export interface ShrinkageRunLogRecord {
    timestamp?: string;
    sessionId?: string;
    toolName: string;
    toolCallId: string;
    command?: string;
    action: string;
    strategy?: string;
    decisionAction?: string;
    decisionReason?: string;
    changed: boolean;
    archived: boolean;
    archiveId?: string;
    rawComplete: boolean;
    rawChars: number;
    finalChars: number;
    rawTokens: number;
    finalTokens: number;
    savedTokens: number;
    durationMs: number;
}
export declare class RunLogStore {
    private readonly cwd;
    private readonly config;
    constructor(cwd: string, config: GovernorConfig);
    write(record: ShrinkageRunLogRecord): void;
}
export declare function estimateTextTokensFromChars(chars: number): number;
export declare function makeTokenCounts(rawChars: number, finalChars: number): {
    rawTokens: number;
    finalTokens: number;
    savedTokens: number;
};
