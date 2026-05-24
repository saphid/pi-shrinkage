# Pi-Shrinkage

Context shrinkage and tool-result pruning for the Pi coding agent.

The extension runs cheap deterministic reducers first, then optionally asks a small model to decide whether a large/ambiguous tool result should be kept, summarized, line-preserved, dismissed, or narrowed. Raw outputs are archived so pruning never destroys evidence.

## Install

```bash
pi install npm:pi-shrinkage
# or during development
pi -e /path/to/pi-shrinkage
```

## What it does

- Intercepts `tool_result` for common verbose tools (`bash`, `read`, `grep`, `find`, `ls`, web/MCP-style tools).
- Archives raw text under `.pi-shrinkage/archive/` by default, with retention limits and optional secret redaction/off mode.
- Applies RTK-style reducers for ANSI, logs, test/build output, git output, search/listings, and source reads.
- Optionally calls a small configured model as a JSON-only policy proxy for large or ambiguous results.
- Registers `tool_result_fetch` so the agent can recover archived output by id/range when a reduction looks insufficient, suspicious, or missing exact lines.
- Logs every governed tool-result decision to JSONL with action, strategy, archive id, raw/final character counts, and estimated raw/final/saved token counts.
- Adds `/shrinkage` status output (`/governor` remains as a compatibility alias).

## Configuration

Create `.pi/pi-shrinkage.json` or `~/.pi/agent/pi-shrinkage.json`:

```json
{
  "enabled": true,
  "archiveRaw": true,
  "archiveDir": ".pi-shrinkage/archive",
  "archivePrivacy": "raw",
  "archiveMaxFiles": 500,
  "archiveMaxAgeDays": 30,
  "archiveMaxBytes": 104857600,
  "redactPolicyInput": true,
  "logRuns": true,
  "logFile": ".pi-shrinkage/runs.jsonl",
  "minCharsForModel": 8000,
  "maxSummaryChars": 3000,
  "model": "google/gemini-2.5-flash-lite",
  "fallback": "rtk",
  "tools": ["bash", "read", "grep", "find", "ls", "web_search", "fetch_content"]
}
```

If `model` is omitted or unavailable, the extension still runs deterministic reducers and falls back safely.

## Safety model

Pi-Shrinkage never deletes active-context evidence unless the original or redacted archive was written first. Every archived reduction includes an explicit recovery footer, for example `tool_result_fetch({ id: "...", startLine, endLine, maxChars })`, so the model can pull the archived result or a narrow slice if the reduced output is not good enough. If a reducer/model is uncertain or fails before safe archiving, the extension returns either the deterministic reduction or the original result, depending on `fallback`.

Archives may contain secrets when `archivePrivacy` is `"raw"` because the point is exact recovery. Set `archivePrivacy` to `"redact"` to store best-effort redacted output. Set `archivePrivacy` to `"off"` to avoid archive writes and leave large outputs unpruned by default; only combine it with `archiveRaw: false` if you intentionally accept pruning without recovery. Retention is enforced with `archiveMaxFiles`, `archiveMaxAgeDays`, and `archiveMaxBytes`; set a limit to `0` to disable that specific retention dimension. Small-model policy prompts redact likely secrets by default via `redactPolicyInput: true`.

## Run log

When `logRuns` is enabled, Pi-Shrinkage appends one JSON object per governed tool result to `logFile` (default `.pi-shrinkage/runs.jsonl`). The log does not include raw tool output. It records what happened (`action`, `strategy`, `decisionAction`, `changed`, `archived`, `archiveId`), approximate token counts using Pi's `ceil(chars / 4)` heuristic (`rawTokens`, `finalTokens`, `savedTokens`), character counts, tool metadata, and duration. Commands are best-effort redacted before logging.
