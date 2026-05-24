![pi-shrinkage banner](assets/readme-banner.png)

# pi-shrinkage

A Pi extension that keeps huge tool results from eating the whole context window.

It sits on Pi's `tool_result` hook, looks at noisy outputs from tools like `bash`, `grep`, `find`, `read`, and web/search tools, and replaces the worst of them with smaller, more useful views. When it does prune something with archiving enabled, it keeps an archive first and adds a recovery hint so the agent can fetch the raw or redacted slice back with `tool_result_fetch`.

The point is not to be clever. The point is to stop dumping 80,000 lines of logs into the model when the useful part is the failing test, the changed file, or the three paths that matter.

## What you get

pi-shrinkage is a **Pi package**. It ships:

- a Pi extension: `dist/src/index.js`
- a Pi skill: `skills/pi-shrinkage/SKILL.md`
- a recovery tool: `tool_result_fetch`
- two commands: `/shrinkage` and `/governor` as an old compatibility alias

It is not a standalone app. You install it into Pi, restart or reload Pi, and it runs in the background.

## Install

From npm, once published:

```bash
pi install npm:pi-shrinkage
```

From a local checkout:

```bash
pi install /path/to/pi-shrinkage
```

For one temporary Pi run while developing:

```bash
pi -e /path/to/pi-shrinkage
```

From a tarball:

```bash
pi install /tmp/pi-shrinkage-0.1.0.tgz
```

Check that Pi sees it:

```bash
pi list
```

Then start a new Pi session or run `/reload`.

## The short version

Large tool output normally does this:

1. the tool returns a wall of text
2. the model burns context reading it
3. the important part may still be buried somewhere in the middle

pi-shrinkage changes that flow:

1. archive the result, usually redacted by default
2. run deterministic reducers for common output shapes
3. optionally ask a small model for a policy decision
4. return the smaller view to the agent
5. leave a `tool_result_fetch({ id })` hint when recovery is available

So the agent keeps moving, but it still has a way to inspect the archived evidence when the reduced view is not enough.

## What gets reduced

The deterministic reducers are deliberately boring:

- strip ANSI escape codes and terminal decoration
- keep failing test output and cut passing noise
- keep build/lint errors and file-line diagnostics
- compact git status, logs, and diffs
- group large grep/search results
- collapse giant directory listings and `find` output
- dedupe repeated lines
- keep source reads exact when lossy compaction would be worse than the original

If the reducer is unsure, it should prefer useful evidence over maximum shrinkage.

## Optional policy model

You can configure a small model to act as a policy proxy. It does not run by default.

When enabled, pi-shrinkage still runs the deterministic reducer first, then asks the model to choose one of:

- `keep`
- `rtk`
- `summarize`
- `keep_lines`
- `dismiss`
- `ask_reread_narrower`

This is intentionally a policy step, not a magic summarizer for everything. The model decides what shape is safe/useful. The extension still controls the recovery footer and fallback behavior.

## Recovery

When pi-shrinkage changes a tool result and an archive exists, the returned text includes a footer like:

```text
[shrinkage: Redacted raw output archived as call-abc123. If this reduction is insufficient, suspicious, or missing exact lines, call tool_result_fetch({ id: "call-abc123" }) ...]
```

The agent can then recover the archived result or a smaller slice:

```js
tool_result_fetch({ id: "call-abc123", startLine: 120, endLine: 180, maxChars: 30000 })
```

That recovery path is the safety valve. If the reduced view looks wrong, suspicious, or too vague, fetch the archive instead of guessing.

## Privacy model

This is the part that matters.

Pruning without recovery is dangerous, but raw archives can contain secrets. pi-shrinkage defaults to the safer middle ground:

```json
{
  "archiveRaw": true,
  "archivePrivacy": "redact",
  "redactPolicyInput": true
}
```

Archive modes:

- `"redact"` — default. Stores best-effort redacted archives. Good public default. Not exact recovery for secrets.
- `"raw"` — exact recovery. Also means raw tool output may be written to disk. Use this only if you actually want that.
- `"off"` — no archive writes. Large outputs are left unchanged unless you explicitly opt into pruning without recovery with `archiveRaw: false`.

Repo-local config can make privacy stricter, but it cannot turn on raw archives, choose a policy model, disable policy-input redaction, or disable archive-before-prune safety by itself. Those are user/global opt-ins.

Archives and logs are written under `.pi-shrinkage/`, with private file modes where the OS supports them. The extension also refuses symlinked store paths instead of following them out of the project.

## Configuration

Project-safe config goes here:

```text
.pi/pi-shrinkage.json
```

User/global config goes here:

```text
~/.pi/agent/pi-shrinkage.json
```

A reasonable default config:

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
  "tools": ["bash", "read", "grep", "find", "ls", "web_search", "fetch_content", "code_search", "mcp__"]
}
```

To opt into exact raw recovery globally:

```json
{
  "archivePrivacy": "raw"
}
```

To enable the optional policy model globally:

```json
{
  "model": "google/gemini-2.5-flash-lite"
}
```

If the model is missing or fails, pi-shrinkage falls back to deterministic reduction.

## Run log

pi-shrinkage writes a JSONL decision log by default:

```text
.pi-shrinkage/runs.jsonl
```

Each line records what happened:

- `sessionId`
- `toolName`, `toolCallId`, redacted/truncated `command`
- `action`, `strategy`, `decisionAction`, redacted/truncated `decisionReason`
- `changed`, `archived`, `archiveId`, `rawComplete`
- `rawChars`, `finalChars`
- `rawTokens`, `finalTokens`, `savedTokens` using Pi's `ceil(chars / 4)` estimate
- `durationMs`

The log is for auditing the mechanism. It should not contain raw tool output.

## Commands

```text
/shrinkage
```

Shows whether the extension is enabled, recent archive entries, rough saved character counts, model state, and the run log path.

```text
/governor
```

Old alias for `/shrinkage`.

## Development

```bash
npm install
npm test
npm audit --omit=dev
npm pack --ignore-scripts --pack-destination /tmp
```

The package publishes built `dist/src/*` files because Pi loads the extension from `dist/src/index.js`.

## Status

This is useful, but it is still context surgery. Treat reductions as a view, not as truth. If the exact line matters, fetch the archive.

## License

MIT
