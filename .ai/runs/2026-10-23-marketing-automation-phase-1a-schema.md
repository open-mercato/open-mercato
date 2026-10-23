# Execution plan — close the remaining review findings on marketing-automation phase 1a schema (adopted from PR #7416)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-23 because PR #7416 carried no execution plan.
**PR:** #7416 · **Branch:** `phase/1a-schema` · **Base:** `main`
**Author:** @michalper — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal
Close the remaining gaps from the 2026-10-16 `om-auto-review-pr` CHANGES_REQUESTED review (6 findings: 1 blocker, 4 major, 1 minor) on the marketing-automation module's schema-only phase 1a, after verifying which of the six were already resolved by the same-day post-review commits.

## Scope
`packages/marketing-automation` migrations/tests, `packages/shared/src/lib/email` tests, `packages/channel-resend` adapter tests (verification only), `packages/cli` generator tests (verification only), the module's `AGENTS.md` (verification only).

## Non-goals
Implementing phase 1b–1e behavior. Re-litigating the module/schema design. Wiring CI to run `.pg.test.ts` suites against a provisioned Postgres (that's a platform/CI decision, out of scope for this part and not requested).

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| Review findings 2 (stableScheduleUuid), 3 (schedules enabled with no worker), 5 (optionalRequires facts coverage), 6 (AGENTS.md budget) are resolved | commits `44ba169460`, `ed7114dedd`, `7b6ac68be3` + reading `setup.ts`/`setup.test.ts`, `module-facts.ts`/its test, running `node scripts/check-agents-md-budget.mjs` | high |
| Finding 4 (headers untested at consuming boundary) is resolved at the adapter boundary (valid headers, CRLF strip, invalid-name drop) but the `sendEmail` → resolved-payload passthrough itself had no test | commit `f2c1c8f63b` + reading `packages/channel-resend/.../adapter.test.ts` and `packages/shared/src/lib/email/__tests__/send.test.ts` | high |
| Finding 1 (blocker: zero DB integration coverage) is resolved for the active-run/occurrence uniqueness invariant the review named, but not for the trigger-context backfill migration the review also named — the only coverage there is SQL-pinning | commit `7d48d160d2` + reading `migrations/__tests__/active-run-occurrence-constraints.pg.test.ts` vs `Migration20261002110000_marketing_trigger_context.test.ts` | high |
| Finding 5's second half (registry variants reject missing hard deps / allow missing optional ones) has no direct test, before or after this PR | reading `module-registry.ts` (`process.exit(1)` on missing hard `requires`, pre-existing, unrelated to this PR's diff) and `__tests__/registry-variant-parity.test.ts` | medium — judged out of proportion to add given `process.exit` makes it test-hostile and the gap predates this PR |

## Assumptions
- The repo's `.pg.test.ts` convention (skip-gated on an env var, never wired into CI) is the accepted way to add "DB integration coverage" here — it matches `packages/core/src/modules/{forms,query_index}` exactly, so a new file in that style satisfies the blocker without requiring CI changes.
- Closing the blocker means covering the two invariants the review named by number (uniqueness indexes, trigger-context backfill), not every one of the 23 tables — the review's own wording singles these out as the risk.

## Risks
- The registry "reject missing hard / allow missing optional" test gap (finding 5, second half) stays open; it is pre-existing and `process.exit`-gated, so forcing coverage in this PR risked more than it fixed. Disclosed in the PR comment for a maintainer to decide.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Original schema/module (23 tables, 6 migrations, vocabulary) — `e7c29e8fcb`
- [x] 1.2 Merge `origin/main` to resolve the review's conflict blocker — `2345aec97b`
- [x] 1.3 Fix `stableScheduleUuid` RFC-4122 shape + round-trip test (finding 2) — `44ba169460`
- [x] 1.4 Disable due-run-scan/sweep schedules until their workers ship (finding 3) — `44ba169460`
- [x] 1.5 SQL-pinning tests for all 6 migrations + real-Postgres uniqueness-index coverage (finding 1, partial) — `7d48d160d2`
- [x] 1.6 Resend adapter header tests: pass-through, CRLF strip, invalid-name drop (finding 4, adapter half) — `f2c1c8f63b`
- [x] 1.7 `optionalRequires` module-facts generator coverage: presence/absence/empty (finding 5, facts half) — `ed7114dedd`
- [x] 1.8 Shrink module `AGENTS.md` under the instruction budget (finding 6) — `7b6ac68be3`
- [x] 1.9 Translate the marketing notification category + fix the merged notification-registry count — `8fef2ead46`, `7d1b3e85ac`

### Phase 2: Close the remaining gaps

- [ ] 2.1 Real-Postgres test for `Migration20261002110000_marketing_trigger_context`'s backfill and rollback (finding 1, trigger-context half)
- [ ] 2.2 Test that `sendEmail`'s `headers` option reaches the resolved payload untouched (finding 4, sendEmail half)
- [ ] 2.3 Full validation gate, self-review pass, push, outcome comment
