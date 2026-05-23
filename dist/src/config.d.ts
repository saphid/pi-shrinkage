export type GovernorFallback = "raw" | "rtk";
export interface GovernorConfig {
    enabled: boolean;
    archiveRaw: boolean;
    archiveDir: string;
    minCharsForModel: number;
    minCharsForRtk: number;
    maxSummaryChars: number;
    model?: string;
    fallback: GovernorFallback;
    tools: string[];
    preserveRecentEditTurns: number;
    policyTimeoutMs: number;
    dryRun: boolean;
}
export declare const DEFAULT_TOOLS: string[];
export declare const DEFAULT_CONFIG: GovernorConfig;
export declare function loadConfig(cwd?: string): GovernorConfig;
export declare function normalizeConfig(input: Partial<GovernorConfig>): GovernorConfig;
export declare function configPath(cwd: string, archiveDir: string): string;
export declare function toolEnabled(toolName: string, config: GovernorConfig): boolean;
export declare function parseModelRef(ref: string | undefined): {
    provider: string;
    id: string;
} | undefined;
