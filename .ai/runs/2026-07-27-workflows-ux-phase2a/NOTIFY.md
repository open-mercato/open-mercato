# Notify — 2026-07-27-workflows-ux-phase2a

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-07-28T04:10:00Z — run started
- Brief: Phase 2a of the workflows UX redesign — context schema, per-step ledger, variable picker + reference warnings, pinned samples, mock-first Test step, context-schema API, structured error bodies.
- External skill URLs: none
- Decisions: no definition.io alias (ports absent on this lineage); mock-first test step (no real effectors); samples without redaction envelope (explicit warning instead); pills/drag/strict/endpoint-picker deferred to 2b per spec cut lines.

## 2026-07-28T06:00:00Z — checkpoint 1
- Steps 1.1..1.3 (fe3694ae0..5050cb370): contextSchema end-to-end (schema, round-trip plumbing, editor UI). 913 workflows tests green; typecheck green after re-adding yarn generate to the chain (dispatcher omission, noted).

## 2026-07-28T08:15:00Z — checkpoint 2
- Steps 2.1..2.3 (892e73b61..d9caa2097): the ledger shipped — pure fixpoint module, schema flattener, API. 977 tests green.
- Honesty findings: AUTOMATED sync outputs and SUB_WORKFLOW outputMapping never reach instance.context (ledger refuses to advertise; sub-workflow case flagged as candidate engine defect for a follow-up issue).

## 2026-07-28T10:30:00Z — checkpoint 3
- Steps 3.1..3.3 (8dbf86e1b..f274bf78c): ref warnings + variable picker landed. 1012 tests green. Honest scope: no picker where the ledger cannot speak (trigger payloads, child-workflow outputs).

## 2026-07-28T13:00:00Z — checkpoint 4
- Steps 4.1..4.4 (bcd7ee91e..1972a0992): samples + mock-first test step complete. 1056 tests green.

## 2026-07-28T15:30:00Z — final gate passed
- Validation 8/8 (one comparator fix-forward); integration 1700 passed, zero workflows failures (only the known unrelated-env onboarding pair); DS CLEAN + focus-ring advisory applied; code review major fixed (legacy edit page now preserves contextSchema/samples with round-trip tests).

## 2026-07-28T16:20:00Z — run complete
- PR: https://github.com/open-mercato/open-mercato/pull/4559 (undrafted, APPROVED via comment, merge-queue + needs-qa; stacked on #4551)
