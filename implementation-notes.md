# Implementation Notes

## Plan-build slices

Invariant: ship a Pi package that reduces tool-result tokens with deterministic RTK-style pruning first, optional small-model policy second, and raw-output recovery as the safety valve.

### Bead B1 — Core deterministic governor
- Allowed paths: `src/config.ts`, `src/text.ts`, `src/rtk.ts`, `src/archive.ts`, `test/core.test.ts`, package scaffolding.
- Acceptance: config loads with safe defaults; text extraction handles Pi text content and object details; archive write/read/range works; deterministic reducers shrink common noisy outputs while preserving error signals and recovery hints.
- Proof: unit tests for config/text/archive/reducers; `npm test`.

### Bead B2 — Policy proxy
- Allowed paths: `src/policy.ts`, `src/decision.ts`, `test/policy.test.ts`.
- Acceptance: strict JSON decisions parse and validate; bad/uncertain model output falls back; model prompts are text-only/no-tools; actions map to final tool-result content with keep-ranges/retrieval hints.
- Proof: unit tests for decision parsing and application; `npm test`.

### Bead B3 — Pi integration
- Allowed paths: `src/index.ts`, `README.md`, `implementation-notes.md`, integration-adjacent tests.
- Acceptance: extension hooks `tool_result`, registers `tool_result_fetch`, registers `/governor`; archives raw output before mutation; runs deterministic pass before policy pass; exposes status.
- Proof: build/typecheck and focused unit tests; manual install instructions documented.

Parallelism: B1 and B2 are mostly independent after shared types are created; B3 depends on both. For this small greenfield package, implementation is integrated on one branch after planning to avoid artificial merge conflicts.

## Decisions

- Use archive-first safety: every transformed large output gets a retrieval id/path before pruning.
- Keep deterministic reducers dependency-free for a small package surface.
- Policy model is optional and pluggable through Pi's model registry; no direct API keys or Gemini CLI coupling.
