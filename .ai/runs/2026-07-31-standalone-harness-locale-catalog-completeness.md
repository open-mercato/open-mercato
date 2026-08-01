# Standalone Harness Locale Catalog Completeness — Execution Plan

Source doc: .ai/specs/2026-07-31-standalone-harness-locale-catalog-completeness.md

## Goal

Extend OMH-185's trusted complete-module oracle so literal `library.*` UI and navigation translation keys must resolve to non-empty values in `en.json` and every emitted sibling locale, with bounded safe parsing and sanitized failures.

## Scope

- Add failure-first regression coverage for the current false acceptance of missing locale keys.
- Implement literal module-key extraction, bounded safe locale discovery/parsing, sibling parity, and non-vacuity in the existing writable AST oracle.
- Keep OMH-185, the runtime i18n API, validator/result schemas, and the sibling canonical-list enforcement spec unchanged.
- Synchronize OMH-185 review evidence and harness documentation where the new fixed contract needs to be visible.
- Certify the change with focused tests, deterministic harness checks, the configured repository gate, and the authoritative review pass.

## Non-goals

- Do not implement canonical DataTable/list UI enforcement from the sibling spec.
- Do not change runtime translation loading, fallback, interpolation, pluralization, or translation-management behavior.
- Do not force a fixed non-English locale set or judge translation quality.
- Do not add a production dependency or execute generated locale code.

## Risks

- Literal-only extraction can reject dynamic-only module keys; this is intentional non-vacuity for OMH-185 and is covered by focused tests.
- Locale parsing consumes model-authored files, so symlinks, path escapes, special files, file counts, per-file bytes, total bytes, malformed JSON, and prototype segments must fail safely.
- Diagnostics must remain useful without exposing absolute paths or catalog contents.

## Implementation Plan

### Phase 1: Failure-first evidence

- Add a fixture proving the existing localization check accepts a literal key whose base catalog is empty.
- Cover representative successful nested-catalog and sibling-locale behavior before changing the oracle owner.

### Phase 2: Bounded catalog oracle

- Extract literal `t(...)` and localized metadata keys for the `library.*` namespace.
- Discover and parse the base and emitted sibling locale catalogs through existing safe-target guards and explicit size/count ceilings.
- Resolve every collected key through plain-object own properties, reject dangerous path segments, and require non-empty string leaves.
- Add the additive `module.locale-catalog` check with sanitized structured failure reasons.

### Phase 3: Synchronization and proof

- Add malformed, blank, non-string, dynamic-only, excessive-input, symlink, and diagnostic-sanitization coverage.
- Synchronize OMH-185/review evidence documentation without adding a new case ID or changing sibling-spec scope.
- Run focused, package, deterministic, repository, and authoritative review gates; record any unavailable live capacity honestly.

## Progress

PR: #4757

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Failure-first evidence

- [x] 1.1 Add missing-key false-acceptance fixture and sanitized before evidence — 9e859bdaf
- [x] 1.2 Add nested base-catalog and emitted sibling-locale fixtures — 9e859bdaf

### Phase 2: Bounded catalog oracle

- [x] 2.1 Implement literal module and metadata key extraction — c91ebf878
- [x] 2.2 Implement safe bounded locale discovery and parsing — c91ebf878
- [x] 2.3 Implement base/sibling resolution, dangerous-segment defense, and non-vacuity — c91ebf878
- [x] 2.4 Add the additive module.locale-catalog check and structured diagnostics — c91ebf878

### Phase 3: Synchronization and proof

- [x] 3.1 Complete malformed, bounds, symlink, and sanitization regression coverage — 2bec5e833
- [x] 3.2 Synchronize OMH-185 generated-review and harness documentation — 31d22ec61
- [ ] 3.3 Run focused, deterministic, full repository, and authoritative review gates — merge conflicts resolved at 6af1dea22; focused oracle tests, deterministic 193/193 validation, and the configured repository gate pass locally; fresh Claude writable execution is blocked before model execution because the isolated runner has no explicit OAuth token, and full release preflight is blocked because macOS cannot provide the required Linux Bubblewrap containment
