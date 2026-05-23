import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ArchiveStore, type ArchiveHandle } from "./archive.js";
import { type GovernorConfig } from "./config.js";
import { type GovernorDecision } from "./decision.js";
import { type RtkResult } from "./rtk.js";
import { type ToolMetadata } from "./text.js";
interface ProcessResult {
    finalText: string;
    archive?: ArchiveHandle;
    rtk: RtkResult;
    decision: GovernorDecision;
    strategy: string;
}
export default function toolResultGovernor(pi: ExtensionAPI): void;
export declare function processToolResult(config: GovernorConfig, archive: ArchiveStore, metadata: ToolMetadata, rawText: string, ctx?: ExtensionContext, details?: unknown, signal?: AbortSignal): Promise<ProcessResult | undefined>;
export {};
