import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDashboardHtml, readRunLogRecords, writeDashboard } from "../src/dashboard.js";
import { normalizeConfig } from "../src/config.js";

test("readRunLogRecords parses JSONL and reports skipped/truncated lines", () => {
	const dir = mkdtempSync(join(tmpdir(), "shrinkage-dashboard-"));
	try {
		const log = join(dir, "runs.jsonl");
		writeFileSync(
			log,
			[
				JSON.stringify({ toolName: "bash", action: "shrunk", rawTokens: 100, finalTokens: 20, savedTokens: 80, changed: true, archived: true }),
				"not json",
				JSON.stringify({ toolName: "grep", action: "unchanged", rawTokens: 40, finalTokens: 40, savedTokens: 0, changed: false, archived: false }),
			].join("\n"),
		);
		const result = readRunLogRecords(log, 2);
		assert.equal(result.totalLines, 3);
		assert.equal(result.truncatedLines, 1);
		assert.equal(result.skippedLines, 1);
		assert.equal(result.records.length, 1);
		assert.equal(result.records[0].toolName, "grep");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("buildDashboardHtml embeds records safely", () => {
	const html = buildDashboardHtml([
		{ toolName: "<img src=x onerror=alert(1)>", action: "shrunk", rawTokens: 100, finalTokens: 10, savedTokens: 90, changed: true, archived: true, command: "echo </script><script>alert(1)</script>", rawText: "must-not-embed" } as any,
	]);
	assert.match(html, /pi-shrinkage usage dashboard/);
	assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
	assert.doesNotMatch(html, /<img src=x/);
	assert.doesNotMatch(html, /must-not-embed/);
	assert.match(html, /\\u003c\/script>/);
	assert.match(html, /escapeHtml\(hit\.tool\)/);
});

test("dashboard refuses symlinked run logs", () => {
	const dir = mkdtempSync(join(tmpdir(), "shrinkage-dashboard-symlink-"));
	const outside = mkdtempSync(join(tmpdir(), "shrinkage-dashboard-outside-"));
	try {
		mkdirSync(join(dir, ".pi-shrinkage"), { recursive: true });
		const outsideLog = join(outside, "runs.jsonl");
		writeFileSync(outsideLog, `${JSON.stringify({ toolName: "bash", action: "shrunk", rawTokens: 100, finalTokens: 1 })}\n`);
		symlinkSync(outsideLog, join(dir, ".pi-shrinkage", "runs.jsonl"));
		assert.throws(() => readRunLogRecords(join(dir, ".pi-shrinkage", "runs.jsonl")), /symlink/i);
		rmSync(join(dir, ".pi-shrinkage", "runs.jsonl"), { force: true });
		rmSync(join(dir, ".pi-shrinkage"), { recursive: true, force: true });
		symlinkSync(outside, join(dir, ".pi-shrinkage"), "dir");
		assert.throws(() => readRunLogRecords(join(dir, ".pi-shrinkage", "runs.jsonl")), /symlink/i);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("writeDashboard writes private static SPA from configured run log", () => {
	const dir = mkdtempSync(join(tmpdir(), "shrinkage-dashboard-write-"));
	try {
		const logDir = join(dir, ".pi-shrinkage");
		mkdirSync(logDir, { recursive: true });
		writeFileSync(
			join(logDir, "runs.jsonl"),
			`${JSON.stringify({ toolName: "bash", action: "shrunk", rawTokens: 100, finalTokens: 25, savedTokens: 75, changed: true, archived: true })}\n`,
		);
		const result = writeDashboard(dir, normalizeConfig({ logFile: ".pi-shrinkage/runs.jsonl" }));
		assert.equal(result.parsedLines, 1);
		assert.equal(existsSync(result.outputPath), true);
		const html = readFileSync(result.outputPath, "utf8");
		assert.match(html, /Where your context went/);
		assert.doesNotMatch(html, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.equal(statSync(result.outputPath).mode & 0o777, 0o600);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
