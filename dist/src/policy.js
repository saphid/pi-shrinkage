import { complete } from "@earendil-works/pi-ai";
import { parseModelRef } from "./config.js";
import { parseDecisionJson } from "./decision.js";
import { redactLikelySecrets } from "./redact.js";
import { numberedLinesWithinBudget, truncateChars } from "./text.js";
export async function decideWithSmallModel(config, ctx, input, signal) {
    const modelRef = parseModelRef(config.model);
    if (!modelRef)
        return undefined;
    const model = ctx.modelRegistry.find(modelRef.provider, modelRef.id);
    if (!model)
        return undefined;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey)
        return undefined;
    const prompt = buildPolicyPrompt(redactPolicyInputIfNeeded(input, config), config.maxSummaryChars);
    const response = await complete(model, {
        messages: [
            {
                role: "user",
                content: [{ type: "text", text: prompt }],
                timestamp: Date.now(),
            },
        ],
    }, {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 1400,
        signal,
    });
    const text = response.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
    const decision = parseDecisionJson(text);
    if (!decision || decision.confidence < 0.45)
        return undefined;
    return decision;
}
export function shouldAskPolicy(config, rawText, rtkText) {
    if (!config.model)
        return false;
    if (rawText.length < config.minCharsForModel)
        return false;
    if (rtkText.length <= config.maxSummaryChars && rtkText.length < rawText.length * 0.4)
        return false;
    return true;
}
export function fallbackDecision(rawText, rtkText, fallback) {
    if (fallback === "raw" || rtkText.length >= rawText.length) {
        return { action: "keep", confidence: 1, reason: "Policy model unavailable; configured fallback keeps raw output." };
    }
    return { action: "rtk", confidence: 0.8, reason: "Policy model unavailable; using deterministic RTK-style reduction." };
}
export function redactPolicyInputIfNeeded(input, config) {
    if (!config.redactPolicyInput)
        return input;
    return {
        ...input,
        command: redactLikelySecrets(input.command).text,
        rawText: redactLikelySecrets(input.rawText).text,
        rtkText: redactLikelySecrets(input.rtkText).text,
    };
}
function buildPolicyPrompt(input, maxSummaryChars) {
    const rawBudget = 60_000;
    return `You are a small-model policy proxy for a coding agent tool result.
You are NOT an agent. You have no tools. Decide how this tool result should appear in the next LLM context.

Return exactly one JSON object with this schema:
{
  "action": "keep" | "rtk" | "summarize" | "keep_lines" | "dismiss" | "ask_reread_narrower",
  "confidence": 0.0-1.0,
  "reason": "short reason",
  "summary": "required for summarize/keep_lines unless action is dismiss",
  "keepRanges": [{"start": 1, "end": 10}]
}

Decision rules:
- keep: exact raw output is small/critical, or exact syntax is likely needed for editing.
- rtk: deterministic reduction already preserves the useful signal.
- summarize: output is useful but exact lines are not needed.
- keep_lines: preserve exact important line ranges and summarize the rest.
- dismiss: result is stale, duplicate, irrelevant, or pure boilerplate.
- ask_reread_narrower: result is too broad and should be queried/read again more narrowly.

Prefer rtk/summarize/keep_lines over keep for large outputs. Never dismiss errors, stack traces, failing assertions, security-relevant facts, or code likely to be edited. Keep summaries under ${maxSummaryChars} characters.

Tool: ${input.toolName}
Command/path/query: ${input.command || "unknown"}
Deterministic strategy: ${input.rtkStrategy}

DETERMINISTIC REDUCTION:
${truncateChars(input.rtkText, 12_000)}

RAW OUTPUT WITH ORIGINAL LINE NUMBERS:
${numberedLinesWithinBudget(input.rawText, rawBudget)}`;
}
