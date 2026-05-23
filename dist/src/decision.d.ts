import type { ArchiveHandle } from "./archive.js";
export type GovernorAction = "keep" | "rtk" | "summarize" | "keep_lines" | "dismiss" | "ask_reread_narrower";
export interface KeepRange {
    start: number;
    end: number;
}
export interface GovernorDecision {
    action: GovernorAction;
    confidence: number;
    reason: string;
    summary?: string;
    keepRanges?: KeepRange[];
}
export interface DecisionApplicationInput {
    decision: GovernorDecision;
    rawText: string;
    rtkText: string;
    archive?: ArchiveHandle;
    maxSummaryChars: number;
}
export declare function parseDecisionJson(text: string): GovernorDecision | undefined;
export declare function normalizeDecision(value: unknown): GovernorDecision | undefined;
export declare function applyDecision(input: DecisionApplicationInput): string;
