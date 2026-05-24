---
name: pi-shrinkage
description: Use when working with Pi-Shrinkage reduced tool results, recovering archived raw/redacted outputs with tool_result_fetch, inspecting shrinkage run logs, or tuning Pi-Shrinkage privacy and retention config.
---

# Pi-Shrinkage

Pi-Shrinkage reduces large Pi tool results before they enter active context. Treat reduced output as a lossy view unless it explicitly says the full/raw or redacted archive is available.

## When a result has a shrinkage footer

1. Read the reduced result first.
2. If it is sufficient, continue.
3. If anything looks suspicious, incomplete, over-summarized, contradictory, or missing exact lines, call:

```json
{"id":"ARCHIVE_ID_FROM_THE_FOOTER","startLine":1,"endLine":200,"maxChars":30000}
```

with the `tool_result_fetch` tool. Prefer `startLine`/`endLine` slices when the footer or reduced output points to a narrow region.

## Recovery expectations

- `archivePrivacy: "raw"` can recover exact original output and may contain secrets.
- `archivePrivacy: "redact"` recovers best-effort redacted output; do not expect exact secrets/tokens to be recoverable.
- `archivePrivacy: "off"` avoids archives; Pi-Shrinkage should leave large outputs unchanged unless the user explicitly configured `archiveRaw: false`.

## Tuning checklist

Use `.pi/pi-shrinkage.json` for project-safe tuning and `~/.pi/agent/pi-shrinkage.json` for user/global privacy opt-ins.

Safe project knobs:

```json
{
  "enabled": true,
  "archivePrivacy": "redact",
  "archiveMaxFiles": 500,
  "archiveMaxAgeDays": 30,
  "archiveMaxBytes": 104857600,
  "logRuns": true,
  "minCharsForRtk": 1200,
  "maxSummaryChars": 3000,
  "fallback": "rtk"
}
```

User/global-only privacy opt-ins:

```json
{
  "archivePrivacy": "raw",
  "model": "google/gemini-2.5-flash-lite",
  "redactPolicyInput": false,
  "archiveRaw": false
}
```

Do not recommend global-only options unless the user understands the privacy/cost tradeoff.

## Run logs

Run logs are JSONL at `.pi-shrinkage/runs.jsonl` by default. They include `sessionId`, tool id/name, action, strategy, archive id, raw/final estimated tokens, saved tokens, and duration. They intentionally do not contain raw tool output.
