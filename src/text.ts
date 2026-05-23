export interface TextExtraction {
	text: string;
	hadText: boolean;
}

export interface ToolMetadata {
	toolName: string;
	toolCallId: string;
	input: unknown;
}

export function extractText(value: unknown): TextExtraction {
	if (typeof value === "string") return { text: value, hadText: true };
	if (Array.isArray(value)) {
		const chunks = value
			.map((part) => {
				if (typeof part === "string") return part;
				if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
					const text = (part as { text?: unknown }).text;
					return typeof text === "string" ? text : "";
				}
				return "";
			})
			.filter(Boolean);
		return { text: chunks.join("\n"), hadText: chunks.length > 0 };
	}
	if (value && typeof value === "object") {
		const object = value as Record<string, unknown>;
		for (const key of ["stdout", "output", "content", "text", "result"]) {
			const nested = object[key];
			if (typeof nested === "string") return { text: nested, hadText: true };
		}
		return { text: JSON.stringify(value, null, 2), hadText: true };
	}
	return { text: "", hadText: false };
}

export function contentFromText(text: string): Array<{ type: "text"; text: string }> {
	return [{ type: "text", text }];
}

export function replaceTextPreservingNonText(original: unknown, text: string): unknown {
	if (!Array.isArray(original)) return contentFromText(text);
	let replaced = false;
	const next: unknown[] = [];
	for (const part of original) {
		if (typeof part === "string") {
			if (!replaced) {
				replaced = true;
				next.push({ type: "text", text });
			}
			continue;
		}
		if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
			if (!replaced) {
				replaced = true;
				next.push({ ...(part as Record<string, unknown>), text });
			}
			continue;
		}
		next.push(part);
	}
	return replaced ? next : [...contentFromText(text), ...original];
}

export function commandFromInput(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const record = input as Record<string, unknown>;
	for (const key of ["command", "path", "pattern", "query", "url"]) {
		const value = record[key];
		if (typeof value === "string") return value;
	}
	return "";
}

export function maybePathFromInput(input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	const path = record.path;
	return typeof path === "string" ? path : undefined;
}

export function lineSlice(text: string, startLine?: number, endLine?: number): string {
	if (!startLine && !endLine) return text;
	const lines = text.split(/\r?\n/);
	const start = Math.max((startLine ?? 1) - 1, 0);
	const end = Math.min(endLine ?? lines.length, lines.length);
	return lines.slice(start, end).join("\n");
}

export function truncateChars(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const head = Math.floor(maxChars * 0.65);
	const tail = Math.max(maxChars - head - 120, 0);
	return `${text.slice(0, head)}\n\n[... truncated ${text.length - head - tail} chars ...]\n\n${text.slice(text.length - tail)}`;
}

export function numberedLines(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line, index) => `${index + 1}\t${line}`)
		.join("\n");
}

export function numberedLinesWithinBudget(text: string, maxChars: number): string {
	const lines = text.split(/\r?\n/);
	const out: string[] = [];
	let used = 0;
	for (let index = 0; index < lines.length; index++) {
		const numbered = `${index + 1}\t${lines[index]}`;
		if (used + numbered.length + 1 > maxChars) {
			out.push(`[... omitted lines ${index + 1}-${lines.length}; ask_reread_narrower or avoid keepRanges for omitted lines ...]`);
			break;
		}
		out.push(numbered);
		used += numbered.length + 1;
	}
	return out.join("\n");
}
