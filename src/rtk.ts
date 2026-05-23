import { commandFromInput, truncateChars } from "./text.js";

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

const COMPACT_BUDGET = 12_000;

type Candidate = { name: string; text: string; confidence: number };

export function reduceDeterministic(rawText: string, context: RtkContext): RtkResult {
	const rawChars = rawText.length;
	const command = commandFromInput(context.input).toLowerCase();
	let text = stripAnsi(rawText);
	let strategy = text === rawText ? "none" : "ansi";
	let confidence = 0.4;

	const exactReadTool = context.toolName === "read";
	const readLikeCommand = isReadLikeCommand(command);
	const explicitSearch = context.toolName === "grep" || startsCommand(command, "(?:rg|grep)");
	const diagnosticOutput = !exactReadTool && !explicitSearch && looksLikeDiagnosticOutput(text);
	const semanticCandidates: Candidate[] = [];
	if (isGitStatus(command)) semanticCandidates.push({ name: "git-status", text: compactGitStatus(text), confidence: 0.94 });
	if (isGitLog(command)) semanticCandidates.push({ name: "git-log", text: compactGitLog(text), confidence: 0.9 });
	if (isGitDiff(command)) semanticCandidates.push({ name: "git-diff", text: compactGitDiff(text), confidence: 0.78 });
	if (isTestCommand(command)) semanticCandidates.push({ name: "test-output", text: compactTestOutput(text), confidence: 0.82 });
	if (isBuildOrLintCommand(command) || diagnosticOutput) semanticCandidates.push({ name: "build-lint", text: compactBuildAndLint(text), confidence: 0.8 });
	if (explicitSearch || (!diagnosticOutput && !exactReadTool && !readLikeCommand && looksLikeSearchOutput(text))) {
		semanticCandidates.push({ name: "search", text: compactSearch(text), confidence: 0.8 });
	}
	if (context.toolName === "ls" || context.toolName === "find" || startsCommand(command, "(?:ls|find|fd|tree|eza)")) semanticCandidates.push({ name: "listing", text: compactListing(text), confidence: 0.72 });

	const fallbackCandidates: Candidate[] = [];
	if (!exactReadTool) {
		fallbackCandidates.push({ name: "log-dedup", text: dedupeConsecutiveLines(text), confidence: 0.7 });
		fallbackCandidates.push({ name: "smart-truncate", text: compactGenericText(text), confidence: 0.55 });
	}

	const bestSemantic = pickSemanticCandidate(semanticCandidates, text.length);
	const bestFallback = pickShortestCandidate(fallbackCandidates, text.length);
	const best = bestSemantic ?? bestFallback;

	if (best) {
		text = best.text;
		strategy = strategy === "none" ? best.name : `${strategy}+${best.name}`;
		confidence = best.confidence;
	}

	return {
		text,
		changed: text !== rawText,
		strategy,
		rawChars,
		finalChars: text.length,
		confidence,
	};
}

export function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function dedupeConsecutiveLines(text: string): string {
	const lines = text.split(/\r?\n/);
	const out: string[] = [];
	let previous = "";
	let count = 0;
	const flush = () => {
		if (!previous && count === 0) return;
		if (count > 2) out.push(`${previous}  [x${count}]`);
		else for (let i = 0; i < count; i++) out.push(previous);
	};
	for (const line of lines) {
		if (line === previous) {
			count++;
		} else {
			flush();
			previous = line;
			count = 1;
		}
	}
	flush();
	return out.join("\n");
}

function isGitStatus(command: string): boolean {
	return startsCommand(command, "git\\s+status");
}
function isGitLog(command: string): boolean {
	return startsCommand(command, "git\\s+log");
}
function isGitDiff(command: string): boolean {
	return startsCommand(command, "git\\s+(?:diff|show)");
}
function isTestCommand(command: string): boolean {
	return startsCommand(
		command,
		"(?:pytest|python\\s+-m\\s+pytest|vitest|jest|mocha|cargo\\s+test|go\\s+test|deno\\s+test|npm\\s+(?:run\\s+)?test|npm\\s+t|pnpm\\s+(?:run\\s+)?test|yarn\\s+(?:run\\s+)?test|bun\\s+(?:run\\s+)?test)",
	);
}
function isBuildOrLintCommand(command: string): boolean {
	return startsCommand(
		command,
		"(?:tsc|eslint|biome|ruff|cargo\\s+clippy|cargo\\s+build|npm\\s+run\\s+build|pnpm\\s+(?:run\\s+)?build|bun\\s+(?:run\\s+)?build|yarn\\s+(?:run\\s+)?build|npx\\s+(?:tsc|eslint|biome)|bunx\\s+(?:tsc|eslint|biome)|pnpm\\s+exec\\s+(?:tsc|eslint|biome))",
	);
}
function startsCommand(command: string, body: string): boolean {
	return new RegExp(`(?:^|[;&|]{1,2}\\s*)(?:env\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\\s]+\\s+)*(?:${body})(?:\\s|$)`).test(command);
}

function isReadLikeCommand(command: string): boolean {
	return startsCommand(command, "(?:cat|sed|nl|head|tail|awk|jq|less|more)");
}

function pickSemanticCandidate(candidates: Candidate[], rawLength: number): Candidate | undefined {
	return candidates
		.filter((candidate) => candidate.text.trim().length > 0 && candidate.text.length < rawLength * 0.95)
		.sort((a, b) => b.confidence - a.confidence || a.text.length - b.text.length)[0];
}

function pickShortestCandidate(candidates: Candidate[], rawLength: number): Candidate | undefined {
	return candidates
		.filter((candidate) => candidate.text.trim().length > 0 && candidate.text.length < rawLength * 0.95)
		.sort((a, b) => a.text.length - b.text.length)[0];
}

function looksLikeSearchOutput(text: string): boolean {
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 240);
	if (lines.length < 8) return false;
	let matches = 0;
	for (const line of lines) {
		if (/^[^:\n]*(?:\/|\b\w+\.(?:[cm]?[jt]sx?|json|md|py|rs|go|java|css|scss|html|sh|yml|yaml|toml))[^:\n]*:\d+:/.test(line)) matches++;
	}
	return matches >= 8 && matches / lines.length >= 0.45;
}

function looksLikeDiagnosticOutput(text: string): boolean {
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 240);
	if (lines.length < 3) return false;
	let matches = 0;
	for (const line of lines) {
		if (/^[^:\n]*(?:\/|\b\w+\.(?:[cm]?[jt]sx?|json|md|py|rs|go|java|css|scss|html|sh|yml|yaml|toml))[^:\n]*:\d+(?::\d+)?:.*\b(error|warning|TS\d{4}|ERR|fatal|undefined|cannot find|failed)\b/i.test(line)) matches++;
	}
	return matches >= 3;
}

function compactGitStatus(text: string): string {
	const porcelain = compactGitPorcelainStatus(text);
	if (porcelain) return porcelain;
	const branch = text.match(/On branch ([^\n]+)/)?.[1] ?? text.match(/##\s*([^\n]+)/)?.[1] ?? "unknown";
	const staged = collectIndentedAfter(text, "Changes to be committed");
	const unstaged = collectIndentedAfter(text, "Changes not staged");
	const untracked = collectIndentedAfter(text, "Untracked files");
	const out = [
		`Git status: ${branch}`,
		formatFileGroup("staged", staged),
		formatFileGroup("unstaged", unstaged),
		formatFileGroup("untracked", untracked),
	].filter(Boolean);
	pushSection(out, "Paths seen anywhere:", extractPathLikeFacts(text), COMPACT_BUDGET);
	return out.join("\n");
}

function compactGitPorcelainStatus(text: string): string | undefined {
	const lines = text.split(/\r?\n/).filter(Boolean);
	if (lines.length === 0) return undefined;
	if (!lines.every((line) => /^(##|[ MTADRCU?!]{1,2}\s+)/.test(line))) return undefined;
	const branch = lines.find((line) => line.startsWith("##"));
	const entries = lines.filter((line) => !line.startsWith("##"));
	const counts = new Map<string, number>();
	for (const line of entries) {
		const code = line.slice(0, 2).trim() || "??";
		counts.set(code, (counts.get(code) ?? 0) + 1);
	}
	const summary = [...counts.entries()].map(([code, count]) => `${code}:${count}`).join(" ");
	const out = [`Git status porcelain${branch ? ` ${branch.slice(3)}` : ""}: ${entries.length} entries ${summary}`.trim()];
	let omitted = 0;
	for (const entry of entries) {
		if (out.join("\n").length + entry.length + 1 > COMPACT_BUDGET) {
			omitted++;
			continue;
		}
		out.push(entry);
	}
	if (omitted > 0) out.push(`[shrinkage: ${omitted} status entries omitted; raw archive has full list]`);
	return appendOmission(out.join("\n"), text, "porcelain status capped");
}

function compactGitLog(text: string): string {
	return text
		.split(/\r?\n/)
		.filter((line) =>
			/^(commit\s+[a-f0-9]+|[a-f0-9]{7,}\s+)/i.test(line.trim()) ||
			/^Author:|^Date:/.test(line) ||
			/^\s{4}\S/.test(line),
		)
		.slice(0, 80)
		.join("\n");
}

function compactGitDiff(text: string): string {
	const lines = text.split(/\r?\n/);
	const kept: string[] = [];
	let keptHunkLines = 0;
	for (const line of lines) {
		if (/^(diff --git|index |--- |\+\+\+ |@@ )/.test(line)) {
			kept.push(line);
			if (line.startsWith("@@")) keptHunkLines = 0;
			continue;
		}
		if (/^[+-]/.test(line) && keptHunkLines < 18) {
			kept.push(line);
			keptHunkLines++;
		}
	}
	return appendOmission(kept.join("\n"), text, "diff context compacted");
}

function compactGenericText(text: string): string {
	const out: string[] = ["Generic compacted output:"];
	pushSection(out, "Key paths/identifiers seen anywhere:", extractPathLikeFacts(text), Math.floor(COMPACT_BUDGET * 0.25));
	pushSection(out, "Important lines seen anywhere:", extractInterestingLines(text), Math.floor(COMPACT_BUDGET * 0.62));
	const remaining = Math.max(COMPACT_BUDGET - out.join("\n").length - 180, 2_000);
	out.push("", "Head/tail excerpt:", truncateChars(text, remaining));
	return out.join("\n");
}

function extractPathLikeFacts(text: string): string[] {
	const facts = new Set<string>();
	const regex = /(?:~|\.|\.\.|\/)?[A-Za-z0-9_@.+-]+(?:\/[A-Za-z0-9_@.+-]+)+(?:\.[A-Za-z0-9_+-]+)?|\b[A-Za-z0-9_@.+-]+\.(?:[cm]?[jt]sx?|json|md|py|rs|go|java|css|scss|html|sh|ya?ml|toml|lock|sql|sqlite|db)\b/g;
	for (const match of text.matchAll(regex)) {
		const fact = match[0].replace(/^['"`(<]+|['"`)>.,:;]+$/g, "");
		if (fact.length >= 4 && fact.length <= 180) facts.add(fact);
		if (facts.size >= 240) break;
	}
	return [...facts];
}

function extractInterestingLines(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length < 12) continue;
		if (!/(fail|failed|error|expected|actual|assert|panic|traceback|exception|warning|TS\d{4}|cannot find|undefined|not ok|fatal|denied|missing)/i.test(trimmed)) continue;
		if (seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
		if (out.length >= 120) break;
	}
	return out;
}

function compactTestOutput(text: string): string {
	const lines = text.split(/\r?\n/);
	const interesting = lines.filter((line) =>
		/(fail|failed|error|expected|actual|assert|panic|traceback|\bnot ok\b|\bFAIL\b)/i.test(line),
	);
	const summary = lines.find((line) => /(tests?\s+(passed|failed)|passed|failed|failures?|success)/i.test(line));
	const body = interesting.slice(0, 120).join("\n");
	return appendOmission([summary, body].filter(Boolean).join("\n"), text, "passing/noisy test output omitted");
}

function compactBuildAndLint(text: string): string {
	const lines = text.split(/\r?\n/);
	const interesting = lines.filter((line) =>
		/(error|warning|TS\d{4}|eslint|ruff|clippy|failed|cannot find|undefined|traceback)/i.test(line),
	);
	return appendOmission(interesting.slice(0, 160).join("\n"), text, "non-error build/lint output omitted");
}

function compactSearch(text: string): string {
	type SearchGroup = { count: number; samples: string[] };
	const groups = new Map<string, SearchGroup>();
	let totalMatches = 0;
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^([^:\n]+):(\d+:)?(.*)$/);
		if (!match) continue;
		const file = match[1];
		const group = groups.get(file) ?? { count: 0, samples: [] };
		group.count++;
		totalMatches++;
		if (group.samples.length < 3) group.samples.push(line);
		groups.set(file, group);
	}
	if (groups.size === 0) return truncateChars(text, COMPACT_BUDGET);

	const out: string[] = [`Search results: ${groups.size} files, ${totalMatches} matches`, "", "Files with matches:"];
	let omittedFiles = 0;
	for (const [file, group] of groups) {
		if (!pushWithinBudget(out, `  ${file} (${group.count})`, Math.floor(COMPACT_BUDGET * 0.75))) {
			omittedFiles++;
		}
	}
	if (omittedFiles > 0) out.push(`  [shrinkage: ${omittedFiles} matching files omitted from active context; raw archive has full list]`);

	out.push("", "Sample matches:");
	let omittedSamples = 0;
	for (const [, group] of groups) {
		for (const sample of group.samples) {
			if (!pushWithinBudget(out, `  ${sample}`, COMPACT_BUDGET)) omittedSamples++;
		}
	}
	if (omittedSamples > 0) out.push(`[shrinkage: ${omittedSamples} sample matches omitted from active context]`);
	return appendOmission(out.join("\n"), text, "search matches grouped; per-file samples capped");
}

function compactListing(text: string): string {
	const lines = text.split(/\r?\n/).filter(Boolean);
	const dirs = lines.filter((line) => line.endsWith("/"));
	const files = lines.filter((line) => !line.endsWith("/"));
	const important = lines.filter(isImportantListingEntry);
	const out: string[] = [`Listing: ${lines.length} entries`];
	pushSection(out, "Important entries found anywhere:", important, Math.floor(COMPACT_BUDGET * 0.35));
	pushSection(out, "Directories/head:", dirs.slice(0, 100), Math.floor(COMPACT_BUDGET * 0.55));
	pushSection(out, "Files/head:", files.slice(0, 140), Math.floor(COMPACT_BUDGET * 0.85));
	pushSection(out, "Tail entries:", lines.slice(-60), COMPACT_BUDGET);
	return appendOmission(dedupeConsecutiveLines(out.join("\n")), text, "listing capped with important/head/tail entries");
}

function pushWithinBudget(out: string[], line: string, budget: number): boolean {
	const current = out.join("\n").length;
	if (current + line.length + 1 > budget) return false;
	out.push(line);
	return true;
}

function pushSection(out: string[], title: string, lines: string[], budget: number): void {
	const seen = new Set(out);
	let added = 0;
	let omitted = 0;
	for (const line of lines) {
		if (seen.has(line)) continue;
		if (added === 0) out.push("", title);
		if (pushWithinBudget(out, line, budget)) {
			seen.add(line);
			added++;
		} else {
			omitted++;
		}
	}
	if (omitted > 0) out.push(`[shrinkage: ${omitted} entries omitted from ${title.toLowerCase()}]`);
}

function isImportantListingEntry(line: string): boolean {
	return /(^|\/)(README|AGENTS|CONTEXT|CLAUDE|GEMINI|package|pnpm-lock|package-lock|yarn\.lock|tsconfig|vite\.config|next\.config|eslint\.config|jest\.config|vitest\.config|pyproject|requirements|Cargo|go\.mod|Dockerfile|docker-compose|\.env\.example|Makefile|TODO|CHANGELOG|LICENSE)(\.|-|_|$)/i.test(line);
}

function collectIndentedAfter(text: string, marker: string): string[] {
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((line) => line.includes(marker));
	if (start < 0) return [];
	const out: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^[A-Z][A-Za-z\s]+:/.test(line)) break;
		const match = line.match(/(?:modified|new file|deleted|renamed|both modified):\s+(.+)$/) ?? line.match(/^\s*([^\s].+)$/);
		if (match && !match[1].startsWith("(")) out.push(match[1].trim());
	}
	return out.slice(0, 200);
}

function formatFileGroup(label: string, files: string[]): string {
	return files.length ? `${label}: ${files.length} file(s)\n  ${files.join("\n  ")}` : "";
}

function appendOmission(compacted: string, original: string, reason: string): string {
	if (!compacted.trim()) return truncateChars(original, 12_000);
	const omitted = original.length - compacted.length;
	if (omitted <= 0) return compacted;
	return `${compacted}\n\n[shrinkage: ${reason}; omitted ~${omitted} chars]`;
}
