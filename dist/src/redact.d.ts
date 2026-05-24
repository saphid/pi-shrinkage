export interface RedactionResult {
    text: string;
    count: number;
}
export interface ValueRedactionResult {
    value: unknown;
    count: number;
}
export declare function redactLikelySecrets(text: string): RedactionResult;
export declare function redactLikelySecretsInValue(value: unknown, seen?: WeakSet<object>, key?: string): ValueRedactionResult;
