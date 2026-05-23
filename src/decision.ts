import type { ArchiveHandle } from "./archive.js";
import { lineSlice, truncateChars } from "./text.js";

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

export function parseDecisionJson(text: string): GovernorDecision | undefined {
	const jsonText = extractJsonObject(text);
	if (!jsonText) return undefined;
	try {
		return normalizeDecision(JSON.parse(jsonText));
	} catch {
		return undefined;
	}
}

export function normalizeDecision(value: unknown): GovernorDecision | undefined {
	if (!value || typeof value !== "object") return undefined;
	const object = value as Record<string, unknown>;
	const action = object.action;
	if (!isAction(action)) return undefined;
	const confidence = clamp(Number(object.confidence ?? 0), 0, 1);
	const reason = typeof object.reason === "string" ? object.reason : "No reason supplied.";
	const summary = typeof object.summary === "string" ? object.summary : undefined;
	const keepRanges = Array.isArray(object.keepRanges)
		? object.keepRanges.flatMap((range): KeepRange[] => {
				if (!range || typeof range !== "object") return [];
				const start = Number((range as Record<string, unknown>).start);
				const end = Number((range as Record<string, unknown>).end);
				if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return [];
				return [{ start: Math.floor(start), end: Math.floor(end) }];
			})
		: undefined;
	return { action, confidence, reason, summary, keepRanges };
}

export function applyDecision(input: DecisionApplicationInput): string {
	const { decision, rawText, rtkText, archive, maxSummaryChars } = input;
	const footer = archive ? `\n\n[shrinkage: ${archive.hint}]` : "";
	switch (decision.action) {
		case "keep":
			return rawText;
		case "rtk":
			return `${rtkText}${footer}`;
		case "dismiss":
			return `Tool result dismissed from active context. Reason: ${decision.reason}.${footer}`;
		case "ask_reread_narrower":
			return `Tool result is too broad for active context. Reason: ${decision.reason}. Re-run the tool with a narrower path/query/range if exact data is needed.${footer}`;
		case "keep_lines":
			return `${formatKeptRanges(rawText, decision.keepRanges)}\n\nSummary: ${truncateChars(decision.summary || decision.reason, maxSummaryChars)}${footer}`;
		case "summarize":
			return `${truncateChars(decision.summary || decision.reason, maxSummaryChars)}${footer}`;
	}
}

function formatKeptRanges(rawText: string, ranges: KeepRange[] | undefined): string {
	if (!ranges || ranges.length === 0) return "[shrinkage: no valid keepRanges supplied]";
	return ranges
		.slice(0, 8)
		.map((range) => `--- kept lines ${range.start}-${range.end} ---\n${lineSlice(rawText, range.start, range.end)}`)
		.join("\n\n");
}

function extractJsonObject(text: string): string | undefined {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate = fenced ?? text;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	return candidate.slice(start, end + 1);
}

function isAction(action: unknown): action is GovernorAction {
	return action === "keep" || action === "rtk" || action === "summarize" || action === "keep_lines" || action === "dismiss" || action === "ask_reread_narrower";
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(Math.max(value, min), max);
}
