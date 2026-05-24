import assert from "node:assert/strict";
import test from "node:test";
import { applyDecision, normalizeDecision, parseDecisionJson } from "../src/decision.js";
import { fallbackDecision, redactPolicyInputIfNeeded, shouldAskPolicy } from "../src/policy.js";
import { normalizeConfig } from "../src/config.js";

test("policy decision JSON parses from fenced output", () => {
	const decision = parseDecisionJson('```json\n{"action":"keep_lines","confidence":0.9,"reason":"important","summary":"sum","keepRanges":[{"start":2,"end":3}]}\n```');
	assert.equal(decision?.action, "keep_lines");
	assert.deepEqual(decision?.keepRanges, [{ start: 2, end: 3 }]);
});

test("invalid decisions are rejected", () => {
	assert.equal(normalizeDecision({ action: "delete", confidence: 1 }), undefined);
	assert.equal(parseDecisionJson("not json"), undefined);
});

test("applyDecision preserves keep ranges and retrieval hint", () => {
	const text = applyDecision({
		decision: { action: "keep_lines", confidence: 1, reason: "only line 2 matters", summary: "second line matters", keepRanges: [{ start: 2, end: 2 }] },
		rawText: "one\ntwo\nthree",
		rtkText: "rtk",
		archive: { id: "abc", path: "/tmp/abc.json", hint: 'Full raw output archived as abc. Use tool_result_fetch({ id: "abc" }) to recover it.' },
		maxSummaryChars: 100,
	});
	assert.match(text, /kept lines 2-2/);
	assert.match(text, /two/);
	assert.match(text, /tool_result_fetch/);
});

test("fallback chooses deterministic reduction when available", () => {
	assert.equal(fallbackDecision("long raw", "short", "rtk").action, "rtk");
	assert.equal(fallbackDecision("raw", "same length or longer", "raw").action, "keep");
});

test("policy trigger skips when rtk already shrank enough", () => {
	const config = normalizeConfig({ model: "google/gemini", minCharsForModel: 10, maxSummaryChars: 1000 });
	assert.equal(shouldAskPolicy(config, "x".repeat(2000), "short"), false);
	assert.equal(shouldAskPolicy(config, "x".repeat(2000), "y".repeat(1600)), true);
});

test("policy input redacts likely secrets by default", () => {
	const input = redactPolicyInputIfNeeded(
		{ toolName: "bash", command: "curl -H 'Authorization: Bearer abcdefghijklmnop'", rawText: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\nDB_PASSWORD=hunter2\nNPM_TOKEN=npm-token", rtkText: "password=hunter2", rtkStrategy: "none" },
		normalizeConfig({}),
	);
	assert.doesNotMatch(input.command, /abcdefghijklmnop/);
	assert.doesNotMatch(input.rawText, /sk-abcdefghijklmnopqrstuvwxyz|hunter2|npm-token/);
	assert.doesNotMatch(input.rtkText, /hunter2/);

	const pem = "before\n-----BEGIN PRIVATE KEY-----\nline1\nline2\n-----END PRIVATE KEY-----\nafter";
	const redactedPem = redactPolicyInputIfNeeded({ toolName: "read", command: "", rawText: pem, rtkText: pem, rtkStrategy: "none" }, normalizeConfig({}));
	assert.equal(redactedPem.rawText.split(/\r?\n/).length, pem.split(/\r?\n/).length);
	assert.match(redactedPem.rawText, /after/);
	const multiline = "before\nPASSWORD=\"line1\nline2\"\nafter";
	const redactedMultiline = redactPolicyInputIfNeeded({ toolName: "read", command: "", rawText: multiline, rtkText: multiline, rtkStrategy: "none" }, normalizeConfig({}));
	assert.equal(redactedMultiline.rawText.split(/\r?\n/).length, multiline.split(/\r?\n/).length);
	assert.doesNotMatch(redactedMultiline.rawText, /line1|line2/);
});
