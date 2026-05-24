const SECRET_PATTERNS = [
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: redactMultilineSecret("REDACTED_PRIVATE_KEY") },
    { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, replacement: "Bearer [REDACTED_TOKEN]" },
    { pattern: /\bBasic\s+[A-Za-z0-9+/=]{12,}/gi, replacement: "Basic [REDACTED_CREDENTIALS]" },
    { pattern: /\b((?:Cookie|Set-Cookie)\s*:\s*)([^\r\n]+)/gi, replacement: "$1[REDACTED_COOKIE]" },
    { pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, replacement: "$1[REDACTED_CREDENTIALS]@" },
    { pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: "[REDACTED_AWS_ACCESS_KEY]" },
    { pattern: /\bgh[pousr]_[A-Za-z0-9_]{24,}\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
    { pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/g, replacement: "[REDACTED_OPENAI_KEY]" },
    { pattern: /\bxox[baprs]-[A-Za-z0-9-]{24,}\b/g, replacement: "[REDACTED_SLACK_TOKEN]" },
    {
        pattern: /\b((?=[A-Za-z_][A-Za-z0-9_-]*\s*[:=])(?=[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|pwd|token|database[_-]?url|db[_-]?url|postgres(?:ql)?[_-]?url|mysql[_-]?url|redis[_-]?url|mongo(?:db)?[_-]?(?:uri|url)|connection[_-]?string))[A-Za-z_][A-Za-z0-9_-]*\s*[:=]\s*)([^\s'\"`,;]+|'[^']+'|"[^"]+")/gi,
        replacement: (match, prefix) => preserveLineCount(match, `${prefix}[REDACTED_SECRET]`),
    },
    {
        pattern: /("[^"]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|pwd|token|database[_-]?url|db[_-]?url|postgres(?:ql)?[_-]?url|mysql[_-]?url|redis[_-]?url|mongo(?:db)?[_-]?(?:uri|url)|connection[_-]?string)[^"]*"\s*:\s*")([^"]+)(")/gi,
        replacement: (match, prefix, _secret, suffix) => preserveLineCount(match, `${prefix}[REDACTED_SECRET]${suffix}`),
    },
    {
        pattern: /([?&](?:token|access_token|refresh_token|api_key|client_secret|password|secret)=)([^&#\s]+)/gi,
        replacement: "$1[REDACTED_SECRET]",
    },
];
export function redactLikelySecrets(text) {
    let redacted = text;
    let count = 0;
    for (const { pattern, replacement } of SECRET_PATTERNS) {
        if (typeof replacement === "function") {
            redacted = redacted.replace(pattern, (...args) => {
                count++;
                const match = args[0];
                const groups = args.slice(1, -2);
                return replacement(match, ...groups);
            });
            continue;
        }
        const matches = redacted.match(pattern);
        if (matches)
            count += matches.length;
        redacted = redacted.replace(pattern, replacement);
    }
    return { text: redacted, count };
}
export function redactLikelySecretsInValue(value, seen = new WeakSet(), key) {
    if (key && isSensitiveKey(key) && value !== undefined && value !== null)
        return { value: "[REDACTED_SECRET]", count: 1 };
    if (typeof value === "string") {
        const redacted = redactLikelySecrets(value);
        return { value: redacted.text, count: redacted.count };
    }
    if (Array.isArray(value)) {
        if (seen.has(value))
            return { value: "[REDACTED_CIRCULAR]", count: 1 };
        seen.add(value);
        let count = 0;
        const next = value.map((item) => {
            const redacted = redactLikelySecretsInValue(item, seen);
            count += redacted.count;
            return redacted.value;
        });
        return { value: next, count };
    }
    if (value && typeof value === "object") {
        if (seen.has(value))
            return { value: "[REDACTED_CIRCULAR]", count: 1 };
        seen.add(value);
        let count = 0;
        const next = {};
        for (const [childKey, child] of Object.entries(value)) {
            const redacted = redactLikelySecretsInValue(child, seen, childKey);
            count += redacted.count;
            next[childKey] = redacted.value;
        }
        return { value: next, count };
    }
    return { value, count: 0 };
}
function redactMultilineSecret(label) {
    return (match) => match.split(/\r?\n/).map(() => `[${label}]`).join("\n");
}
function preserveLineCount(match, replacement) {
    const lineCount = match.split(/\r?\n/).length;
    if (lineCount <= 1)
        return replacement;
    return [replacement, ...Array.from({ length: lineCount - 1 }, () => "[REDACTED_CONTINUED]")].join("\n");
}
function isSensitiveKey(key) {
    return /^(authorization|cookie|set-cookie)$/i.test(key) || /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|pwd|token|database[_-]?url|db[_-]?url|postgres(?:ql)?[_-]?url|mysql[_-]?url|redis[_-]?url|mongo(?:db)?[_-]?(?:uri|url)|connection[_-]?string)(?:[_-]|$)/i.test(key);
}
