import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export function ensurePrivateDirectory(dir: string): void {
	assertNoSymlinkInStorePath(dir);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	assertNoSymlinkInStorePath(dir);
	try {
		chmodSync(dir, 0o700);
	} catch {
		// Best-effort on platforms/filesystems that do not support POSIX modes.
	}
	writeIgnoreFile(dir);
	const parent = dirname(dir);
	if (parent !== dir && parent.endsWith("/.pi-shrinkage")) {
		writeIgnoreFile(parent);
	}
}

export function ensurePrivateFileParent(path: string): void {
	ensurePrivateDirectory(dirname(path));
	assertNotSymlink(path);
}

export function assertNotSymlink(path: string): void {
	try {
		if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${path}`);
	} catch (error) {
		if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return;
		throw error;
	}
}

function assertNoSymlinkInStorePath(target: string): void {
	const absolute = resolve(target);
	const parsed = parse(absolute);
	const parts = absolute.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
	const storeIndex = parts.indexOf(".pi-shrinkage");
	if (storeIndex < 0) return;
	for (let index = storeIndex; index < parts.length; index++) {
		const path = join(parsed.root, ...parts.slice(0, index + 1));
		assertNotSymlink(path);
	}
}

function writeIgnoreFile(dir: string): void {
	const path = join(dir, ".gitignore");
	assertNotSymlink(path);
	if (existsSync(path)) return;
	try {
		writeFileSync(path, "*\n!.gitignore\n", { mode: 0o600 });
	} catch {
		// Ignore: gitignore creation is a safety net, not part of core behavior.
	}
}
