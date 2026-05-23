export interface TextExtraction {
    text: string;
    hadText: boolean;
}
export interface ToolMetadata {
    toolName: string;
    toolCallId: string;
    input: unknown;
}
export declare function extractText(value: unknown): TextExtraction;
export declare function contentFromText(text: string): Array<{
    type: "text";
    text: string;
}>;
export declare function replaceTextPreservingNonText(original: unknown, text: string): unknown;
export declare function commandFromInput(input: unknown): string;
export declare function maybePathFromInput(input: unknown): string | undefined;
export declare function lineSlice(text: string, startLine?: number, endLine?: number): string;
export declare function truncateChars(text: string, maxChars: number): string;
export declare function numberedLines(text: string): string;
export declare function numberedLinesWithinBudget(text: string, maxChars: number): string;
