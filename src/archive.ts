import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import type { GovernorConfig } from "./config.js";
import { configPath } from "./config.js";
import { lineSlice, truncateChars } from "./text.js";

export interface ArchiveRecord {
	id: string;
	toolCallId: string;
	toolName: string;
	command: string;
	createdAt: string;
	rawChars: number;
	finalChars?: number;
	rawText: string;
	input?: unknown;
}

export interface ArchiveHandle {
	id: string;
	path: string;
	hint: string;
}

export class ArchiveStore {
	private readonly records = new Map<string, ArchiveRecord>();

	constructor(
		private readonly cwd: string,
		private readonly config: GovernorConfig,
	) {}

	save(record: Omit<ArchiveRecord, "id" | "createdAt" | "rawChars">): ArchiveHandle | undefined {
		if (!this.config.archiveRaw) return undefined;
		const id = makeArchiveId(record.toolCallId, record.toolName, record.rawText);
		const fullRecord: ArchiveRecord = {
			...record,
			id,
			createdAt: new Date().toISOString(),
			rawChars: record.rawText.length,
		};
		const dir = configPath(this.cwd, this.config.archiveDir);
		mkdirSync(dir, { recursive: true });
		const path = join(dir, `${id}.json`);
		writeFileSync(path, JSON.stringify(fullRecord, null, 2));
		this.records.set(id, fullRecord);
		return {
			id,
			path,
			hint: `Full raw output archived as ${id}. If this reduction is insufficient, suspicious, or missing exact lines, call tool_result_fetch({ id: "${id}" }) to recover the raw result; use startLine/endLine/maxChars for a smaller slice.`,
		};
	}

	fetch(id: string, options: { startLine?: number; endLine?: number; maxChars?: number } = {}): ArchiveRecord | undefined {
		const normalized = sanitizeId(id);
		const memory = this.records.get(normalized);
		if (memory) return sliceRecord(memory, options);
		const path = resolve(configPath(this.cwd, this.config.archiveDir), `${normalized}.json`);
		if (!existsSync(path)) return undefined;
		try {
			const record = JSON.parse(readFileSync(path, "utf8")) as ArchiveRecord;
			this.records.set(record.id, record);
			return sliceRecord(record, options);
		} catch {
			return undefined;
		}
	}

	list(limit = 20): ArchiveRecord[] {
		const dir = configPath(this.cwd, this.config.archiveDir);
		if (!existsSync(dir)) return [];
		return readdirSync(dir)
			.filter((file) => file.endsWith(".json"))
			.flatMap((file) => {
				try {
					const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as ArchiveRecord;
					return [record];
				} catch {
					return [];
				}
			})
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
			.slice(0, limit);
	}
}

export function makeArchiveId(toolCallId: string, toolName: string, rawText: string): string {
	const base = sanitizeId(toolCallId || toolName || "tool-result").slice(0, 60);
	const hash = createHash("sha256").update(`${toolCallId}\n${toolName}\n${rawText}`).digest("hex").slice(0, 10);
	return `${base || "tool-result"}-${hash}`;
}

function sanitizeId(id: string): string {
	return basename(id).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function sliceRecord(record: ArchiveRecord, options: { startLine?: number; endLine?: number; maxChars?: number }): ArchiveRecord {
	const sliced = lineSlice(record.rawText, options.startLine, options.endLine);
	return {
		...record,
		rawText: truncateChars(sliced, options.maxChars ?? sliced.length),
	};
}
