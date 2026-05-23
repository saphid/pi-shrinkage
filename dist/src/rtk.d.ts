export interface RtkResult {
    text: string;
    changed: boolean;
    strategy: string;
    rawChars: number;
    finalChars: number;
    confidence: number;
}
export interface RtkContext {
    toolName: string;
    input: unknown;
}
export declare function reduceDeterministic(rawText: string, context: RtkContext): RtkResult;
export declare function stripAnsi(text: string): string;
export declare function dedupeConsecutiveLines(text: string): string;
