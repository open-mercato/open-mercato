# Stabilize main CI

## Goal
Restore green full-suite CI on a dedicated draft PR against main.

## Scope
Diagnose main run 42050421442, fix proven causes, support ci-full label scope, and verify all PR checks. Existing dated branch belongs to merged PR #8739; use a v2 branch without rewriting it.

## Non-goals
No unrelated refactors, skipped checks, production changes, or merges into main.

## Implementation Plan
Phase 1: Diagnose build failures and implement root-cause fixes with regression coverage. Independently delegate read-only diagnosis; keep workflow and code edits coordinated here.
Phase 2: Run configured validation and full PR CI, repair any remaining failures, then dispatch one final independent review and resolve findings.
Phase 3: Record evidence, release claims, promote ready and add automerge only after green checks and approved review.

## Validation evidence
CI run 42075693679 passed prepare, lint, DS, Docker, timezone and multi-instance jobs; 14/15 integration shards passed while shard 14 was still running. Unit job exposed OMH-057 context growth: 115086 bytes exceeded its 114688-byte cap. Recalibrated only its total allowance to 116736 bytes (1650 bytes headroom); initial allowance, exact files and forbidden paths remain fixed. Existing compatibility regression reproduced failure before and passed all 6 tests after; source-link inventory check passed unchanged. Local configured gate passed build/generate/rebuild/i18n sync/usage, then was interrupted during typecheck; remaining verification comes from full PR CI.

## Review resolution
Independent review 876f83d1 requested governance certification for OMH-057. Added an explicit focused footprint/access-restriction regression. Controller knowledge-change validation passed against bbd7b4db9: base with new test exits 1, current tree exits 0; sanitized controller result is in `2026-11-05-stabilize-main-v2-knowledge-change.json`. Required contracts are context-read/evaluator; affected lane is deterministic. Compatibility tests pass 7/7, governance controller tests pass, source-link inventory remains current. No owner, source link, case count, mode, oracle, initial budget or readable-path policy changed. A fresh local create-app build and pack completed; packed catalog matches source byte-for-byte (SHA256 ad7cc56d0bf48c5933103e63da29fc73d884da45da9016d63200a844b5839a36). Classic scaffold from that pack succeeded; a freshly generated Codex preset using the packed catalog passed deterministic OMH-057 1/1. Full live agent release certification was not run; no routing, writable implementation or runtime oracle changed.

## Risks
Full CI can expose additional failures after prepare succeeds. No local dependencies installed initially. ci-full applies on next scheduled PR event, avoiding label-only skipped check replacement.

## Progress
PR: #8806

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Repair
- [x] 1.1 Diagnose main failures and fix root causes with regression coverage — ef42a952c
- [x] 1.2 Support ci-full full-suite selection with regression tests — ef42a952c

### Phase 2: Verify
- [ ] 2.1 Pass configured validation and all full-suite PR checks
- [ ] 2.2 Obtain independent final review and address findings

### Phase 3: Handoff
- [ ] 3.1 Record evidence and mark green reviewed PR ready with automerge
