# Fix dev log-policy allowlists for the structured-logging format

Date: 2026-07-13
Slug: dev-log-policy-structured-format
Branch: fix/dev-log-policy-structured-format

## Overview

### Goal

Stop the compact dev runtime (`yarn dev` / `yarn dev:greenfield`) from auto-revealing raw debug logs on benign Vault-fallback noise, and stop the package watcher's watch-scope announcement from printing `❌ Package watch emitted raw output`.

### Background

The structured-logging facade (`.ai/specs/2026-07-02-structured-logging-facade.md`, `@open-mercato/shared/lib/logger`) changed how the KMS/Vault dev-fallback warnings render. The pretty transport emits `HH:MM:SS.mmm LEVEL [scope] message key=value`, and an `err` binding appends the error stack on following lines (first line e.g. `TypeError: fetch failed`).

The noise allowlist in `apps/mercato/scripts/dev-runtime-log-policy.mjs` still matches the pre-facade formats only:

- `⚠️ [encryption][kms] Vault read error` — now `12:16:22.204 WARN  [shared:kms] Vault read error path=... timeoutMs=1000`
- `error: 'fetch failed'` (old object dump) — now a bare `TypeError: fetch failed` stack line
- `Secret: ` — the banner line is actually `Secret fingerprint (sha256, truncated): ...`

Consequence: `looksLikeFailure` in `apps/mercato/scripts/dev.mjs` matches `TypeError: fetch failed` (and the `Vault read failed` / `Vault write failed` message variants) via `/\bfailed\b/i`, flips the reporter into permanent passthrough, and auto-opens the raw log panel on every dev boot where Vault is unreachable — the intended dev fallback path.

Separately, `scripts/watch-packages.mjs` emits `[watch] watch scope: ...` lines that `isIgnorableConsolidatedWatchLine` in `scripts/dev-orchestration-log-policy.mjs` does not cover, producing a spurious `❌ Package watch emitted raw output` line.

### Scope

- `apps/mercato/scripts/dev-runtime-log-policy.mjs` — recognize the structured-log pretty format for the KMS/Vault fallback lines (strip the `HH:MM:SS.mmm LEVEL` prefix before matching), cover the new message texts (`[shared:kms] Vault read|write error|failed`, `No tenant DEK found in Vault`, bare `TypeError: fetch failed` stack head, `Secret fingerprint (sha256, truncated):`, `Source: dev default secret`), keep all old-format matches for backward compatibility.
- `scripts/dev-orchestration-log-policy.mjs` — add `[watch] watch scope: ...` lines to `isIgnorableConsolidatedWatchLine`.
- Unit tests in `apps/mercato/scripts/__tests__/dev-runtime-log-policy.test.mjs` and `scripts/__tests__/dev-orchestration-log-policy.test.mjs` (run via `yarn test:scripts`).
- Template mirror: `packages/create-app/template/scripts/dev-runtime-log-policy.mjs` and `packages/create-app/template/scripts/dev-orchestration-log-policy.mjs` are byte-identical copies today and must stay in sync (create-app Template Sync Checklist).

### Non-goals

- No changes to the structured-logging facade or the KMS/Vault code in `packages/shared`.
- No changes to `looksLikeFailure` / `classifyServerLine` heuristics in `apps/mercato/scripts/dev.mjs` — the fix is confined to the noise allowlist predicates.
- No broader migration of other legacy predicates (queue/scheduler/bootstrap) to the structured prefix beyond what the Vault-fallback fix requires.

## Implementation Plan

### Phase 1: Runtime log-policy fix (apps/mercato)

1.1 Add a structured-log prefix helper and extend `isIgnorableDerivedKeyWarningLine` to match both old and new formats, including the bare `TypeError: fetch failed` stack head and the current banner lines.
1.2 Extend `apps/mercato/scripts/__tests__/dev-runtime-log-policy.test.mjs` with cases for every new-format line observed in a real `yarn dev:greenfield` boot, plus negative cases proving real failures still surface.

### Phase 2: Orchestration log-policy fix (root scripts)

2.1 Add `[watch] watch scope: ...` to `isIgnorableConsolidatedWatchLine` and extend `scripts/__tests__/dev-orchestration-log-policy.test.mjs`.

### Phase 3: Template sync

3.1 Mirror both edited policy files verbatim into `packages/create-app/template/scripts/`.

## Risks

- Over-suppression: blanket-ignoring `TypeError: fetch failed` could hide a real fetch failure in the raw panel trigger. Accepted: in the dev reporter context this line is overwhelmingly the Vault health probe; the line still lands in the raw log buffer (visible via `[d]`), and genuine failures print additional non-allowlisted lines that still trigger the reveal.
- Format drift: the pretty-transport format could change again. Mitigated by matching a tolerant prefix regex and by unit tests that copy real observed lines.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runtime log-policy fix (apps/mercato)

- [x] 1.1 Extend dev-runtime-log-policy predicates for structured-log format — 73146de34
- [x] 1.2 Extend dev-runtime-log-policy unit tests — 73146de34

### Phase 2: Orchestration log-policy fix (root scripts)

- [x] 2.1 Ignore watch-scope announcements in isIgnorableConsolidatedWatchLine + tests — 59abc32ea

### Phase 3: Template sync

- [x] 3.1 Mirror updated policy files into packages/create-app/template/scripts — 6c73c8b3b
