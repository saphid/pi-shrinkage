import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GovernorConfig } from "./config.js";
import type { GovernorDecision } from "./decision.js";
export interface PolicyInput {
    toolName: string;
    command: string;
    rawText: string;
    rtkText: string;
    rtkStrategy: string;
}
export declare function decideWithSmallModel(config: GovernorConfig, ctx: ExtensionContext, input: PolicyInput, signal?: AbortSignal): Promise<GovernorDecision | undefined>;
export declare function shouldAskPolicy(config: GovernorConfig, rawText: string, rtkText: string): boolean;
export declare function fallbackDecision(rawText: string, rtkText: string, fallback: GovernorConfig["fallback"]): GovernorDecision;
export declare function redactPolicyInputIfNeeded(input: PolicyInput, config: Pick<GovernorConfig, "redactPolicyInput">): PolicyInput;
