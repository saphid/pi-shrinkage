import { type GovernorConfig } from "./config.js";
import type { ShrinkageRunLogRecord } from "./log.js";
export type DashboardRecord = Pick<Partial<ShrinkageRunLogRecord>, "timestamp" | "sessionId" | "toolName" | "toolCallId" | "command" | "action" | "strategy" | "decisionAction" | "decisionReason" | "changed" | "archived" | "archiveId" | "rawComplete" | "rawChars" | "finalChars" | "rawTokens" | "finalTokens" | "savedTokens" | "durationMs"> & {
    version?: number;
};
export interface RunLogReadResult {
    records: DashboardRecord[];
    totalLines: number;
    parsedLines: number;
    skippedLines: number;
    truncatedLines: number;
    path: string;
}
export interface DashboardBuildResult extends RunLogReadResult {
    outputPath: string;
}
export declare const DASHBOARD_OUTPUT_PATH = ".pi-shrinkage/dashboard/index.html";
export declare const DEFAULT_DASHBOARD_MAX_RECORDS = 10000;
export declare function readRunLogRecords(path: string, maxRecords?: number): RunLogReadResult;
export declare function writeDashboard(cwd: string, config: GovernorConfig, maxRecords?: number): DashboardBuildResult;
export declare function buildDashboardHtml(records: DashboardRecord[], metadata?: Record<string, unknown>): string;
