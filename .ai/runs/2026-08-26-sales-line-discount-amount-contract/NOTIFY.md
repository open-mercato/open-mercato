# Notify — 2026-08-26-sales-line-discount-amount-contract

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-08-26T05:52:00Z — run started
- Brief: implement §§ 1–4 of the approved sales line `discount_amount` contract, so the column means a line total on both the read and the write path and recalculation becomes idempotent.
- External skill URLs: none.

## 2026-08-26T05:52:00Z — decision: the maintainer approval that unblocks this run
- @wojciechszyjka approved § Proposed Solution 1 (the column is a line total) and § Proposed Solution 2 (percentage-first precedence, a stored `0` treated as absent) on 2026-08-26, releasing a gate the spec had held since 2026-08-07.
- Four further calls were resolved rather than deferred back to the user, because each follows from the approval and stopping on any of them would have delivered nothing: D3 — `discountAmount: 0` alongside a non-zero percent now applies the percentage, which is § 2 as written; D4 — § Alternatives E is not adopted, since the § 3 type shape is identical either way and E stays additively adoptable later; D5 — the opt-in operator repair CLI is deferred to a follow-up issue rather than bundled into an already-large behaviour change; D6 — the duplicated mapper is extracted rather than kept behind an equivalence test.

## 2026-08-26T05:52:00Z — decision: plan drafted against live code, not the spec's pinned lines
- The spec pins its source sites to `develop@33a7d00c4` and states in its own header that those line numbers drift. Every anchor was therefore re-verified against `develop@97319f09f` before planning: the defect in `buildBaseLineResult`, the two upsert coalescing sites (`commands/documents.ts:7270` and `:7764`), and the three entity→snapshot mappers (`documents.ts:2972`, `:3003`, `returns.ts:137`). All were found where the spec's symbol-led citations said they would be.

## 2026-08-26T05:52:00Z — decision: engine routing
- `om-auto-create-pr` drafted 24 Steps against a `LOOP_STEP_THRESHOLD` of 20 and handed the run to `om-auto-create-pr-loop`. The step count was not shaved to avoid the handoff: the change genuinely spans types, the calculation engine, two command files, the validators, a component, the upgrade notes and three test layers, and the loop engine is the resumable one.

## 2026-08-26T05:52:00Z — environment note
- The reused linked worktree had no `node_modules`; a full `yarn install` was run here before any validation. It completed cleanly. Nothing was symlinked into the worktree — doing so has previously emptied the source checkout's install.
