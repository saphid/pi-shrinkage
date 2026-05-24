![Pi-Shrinkage banner](assets/readme-banner.png)

# Pi-Shrinkage

Context shrinkage and tool-result pruning for the Pi coding agent.

Pi-Shrinkage runs cheap deterministic reducers first, then can optionally ask a user-configured small model whether a large/ambiguous result should be kept, summarized, line-preserved, dismissed, or narrowed. Reduced outputs include recovery hints, and the package ships a `tool_result_fetch` tool so the agent can pull the archived result back when the reduction is not enough.

## What ships in this package

- Pi extension: `dist/src/index.js`
- Pi skill: `skills/pi-shrinkage/SKILL.md`
- Recovery tool: `tool_result_fetch`
- Commands: `/shrinkage` and compatibility alias `/governor`

The repo does **not** vendor unrelated global/user skills. It only includes its own Pi-Shrinkage skill.

## Install

```bash
pi install npm:pi-shrinkage
# or during development
pi -e /path/to/Pi-Shrinkage
# or from a local tarball
pi install /tmp/pi-shrinkage-0.1.0.tgz
```

## What it does

- Intercepts `tool_result` for common verbose tools (`bash`, `read`, `grep`, `find`, `ls`, web/search/MCP-style tools).
- Archives only when the active-context result will actually change, so unchanged large outputs are not needlessly hoarded.
- Defaults to best-effort redacted archives under `.pi-shrinkage/archive/` with private file modes, local `.gitignore` safety files, and retention limits.
- Applies RTK-style reducers for ANSI, logs, test/build output, git output, search/listings, and source reads.
- Optionally calls a user/global configured small model as a JSON-only policy proxy for large or ambiguous results.
- Registers `tool_result_fetch` so the agent can recover archived output by id/range when a reduction looks insufficient, suspicious, or missing exact lines.
- Logs every governed tool-result decision to JSONL with `sessionId`, action, strategy, archive id, raw/final character counts, and estimated raw/final/saved token counts.

## Configuration

Create `.pi/pi-shrinkage.json` for project-safe tuning or `~/.pi/agent/pi-shrinkage.json` for user/global privacy opt-ins.

```json
{
  "enabled": true,
  "archiveRaw": true,
  "archiveDir": ".pi-shrinkage/archive",
  "archivePrivacy": "redact",
  "archiveMaxFiles": 500,
  "archiveMaxAgeDays": 30,
  "archiveMaxBytes": 104857600,
  "redactPolicyInput": true,
  "logRuns": true,
  "logFile": ".pi-shrinkage/runs.jsonl",
  "minCharsForModel": 8000,
  "minCharsForRtk": 1200,
  "maxSummaryChars": 3000,
  "fallback": "rtk",
  "tools": ["bash", "read", "grep", "find", "ls", "web_search", "fetch_content"]
}
```

Raw archives and model policy are user/global opt-ins. A repo-local config can make privacy stricter, but it cannot by itself enable raw archive storage, disable policy-input redaction, disable archive-before-prune safety, or choose a policy model.

User/global opt-in example:

```json
{
  "archivePrivacy": "raw",
  "model": "google/gemini-2.5-flash-lite"
}
```

If `model` is omitted or unavailable, Pi-Shrinkage still runs deterministic reducers and falls back safely.

## Safety model

Pi-Shrinkage does not prune active-context evidence unless an archive was written first, unless you explicitly set `archiveRaw: false` in user/global config. Every archived reduction includes a footer such as `tool_result_fetch({ id: "...", startLine, endLine, maxChars })`, so the model can pull the archived result or a narrow slice if the reduced output is not good enough.

Privacy modes:

- `archivePrivacy: "redact"` — default. Stores best-effort redacted archives. Good public default; not exact recovery for secrets.
- `archivePrivacy: "raw"` — exact recovery, but archived tool outputs may contain secrets. User/global opt-in only.
- `archivePrivacy: "off"` — avoids archive writes and leaves large outputs unpruned by default.

Retention is enforced with `archiveMaxFiles`, `archiveMaxAgeDays`, and `archiveMaxBytes`; set a limit to `0` to disable that specific dimension. Small-model policy prompts redact likely secrets by default via `redactPolicyInput: true`.

## Run log

When `logRuns` is enabled, Pi-Shrinkage appends one JSON object per governed tool result to `logFile` (default `.pi-shrinkage/runs.jsonl`). The log does not include raw tool output. It records:

- `sessionId`
- `toolName`, `toolCallId`, redacted/truncated `command`
- `action`, `strategy`, `decisionAction`, redacted/truncated `decisionReason`
- `changed`, `archived`, `archiveId`, `rawComplete`
- `rawChars`, `finalChars`
- `rawTokens`, `finalTokens`, `savedTokens` using Pi's `ceil(chars / 4)` estimate
- `durationMs`

## Development

```bash
npm install
npm test
npm audit --omit=dev
npm pack --ignore-scripts --pack-destination /tmp
```

## License

MIT
