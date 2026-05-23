import { lineSlice, truncateChars } from "./text.js";
export function parseDecisionJson(text) {
    const jsonText = extractJsonObject(text);
    if (!jsonText)
        return undefined;
    try {
        return normalizeDecision(JSON.parse(jsonText));
    }
    catch {
        return undefined;
    }
}
export function normalizeDecision(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const object = value;
    const action = object.action;
    if (!isAction(action))
        return undefined;
    const confidence = clamp(Number(object.confidence ?? 0), 0, 1);
    const reason = typeof object.reason === "string" ? object.reason : "No reason supplied.";
    const summary = typeof object.summary === "string" ? object.summary : undefined;
    const keepRanges = Array.isArray(object.keepRanges)
        ? object.keepRanges.flatMap((range) => {
            if (!range || typeof range !== "object")
                return [];
            const start = Number(range.start);
            const end = Number(range.end);
            if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start)
                return [];
            return [{ start: Math.floor(start), end: Math.floor(end) }];
        })
        : undefined;
    return { action, confidence, reason, summary, keepRanges };
}
export function applyDecision(input) {
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
function formatKeptRanges(rawText, ranges) {
    if (!ranges || ranges.length === 0)
        return "[shrinkage: no valid keepRanges supplied]";
    return ranges
        .slice(0, 8)
        .map((range) => `--- kept lines ${range.start}-${range.end} ---\n${lineSlice(rawText, range.start, range.end)}`)
        .join("\n\n");
}
function extractJsonObject(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const candidate = fenced ?? text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start)
        return undefined;
    return candidate.slice(start, end + 1);
}
function isAction(action) {
    return action === "keep" || action === "rtk" || action === "summarize" || action === "keep_lines" || action === "dismiss" || action === "ask_reread_narrower";
}
function clamp(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.min(Math.max(value, min), max);
}
