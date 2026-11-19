# Plan — 2026-11-19 r5-pr1a-code-use-reversal

**Brief:** eComm Release 5 re-landing step PR1a — make a recorded code use reversible and `useCode` retry-safe.
**Binding spec:** `.ai/specs/SPEC-055-2026-02-23-promotions-module.md` (v2.5.0 on #9996) — §Release 5 Re-landing row "PR1a", §Code Lifecycle, §Data Models "CodeUsage", §API Contracts `codes/use`, §Public TypeScript Contract, decisions D-R5-PR1…8.
**Reference implementation:** closed PR #8268 at `bdb747c36a`, diff base `b7b5309ccc` — ported, not redesigned.
**Base:** `refs/remotes/pr/9996` (`7e41bb84f1`, stacked on #9996 → #9988); PR base `main`.
**Branch:** `feat/r5-pr1a-code-use-reversal`
**Mode:** Spec-implementation run.

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | `CodeUsage` columns, migration `Migration20261119224920_promotions`, snapshot block | inline | done | |
| 1 | 1.2 | `useCode` replay + `orderId`; `revertCodeUse`, command `promotions.code.use.revert`, optional facade member; unit tests | inline | done | |
| 1 | 1.3 | `TC-PROM-090` HTTP replay integration spec | inline | todo | |
| 1 | 1.4 | `UPGRADE_NOTES.md` entry; SPEC-055 changelog 2.5.1 | inline | todo | |

## Goal

- `POST /api/promotions/codes/use` / `useCode` is idempotent per `(codeId, cartId, orderId ?? null)`, checked before and under the `Code` row lock.
- A recorded use can be reverted in-process (`revertCodeUse`, command `promotions.code.use.revert`) by `cartId` or `orderId`.
- `PromotionsService.revertCodeUse?` is optional (D-R5-PR6).

## Scope (all under `packages/core/src/modules/promotions/`)

- `data/entities.ts` (`CodeUsage`: `cartId`, `orderId`, `generatedCodeId`, `revertedAt`, two indexes), `migrations/Migration20261119224920_promotions.ts`, snapshot block `promotion_code_usages`.
- `lib/code-service.ts`: the five `useCode` hunks, `revertCodeUse`, `RevertCodeUse*` imports. `commands/codes.ts`: `promotions.code.use.revert`.
- `lib/promotions-service.ts`: `revertCodeUse()`. `lib/types.ts`: `UseCodeInput.orderId`, `RevertCodeUseInput/Result`, `revertCodeUse?`.
- `data/validators.ts`: the last hunk only (`codeUseInputSchema.orderId`, `revertCodeUseInputSchema`).
- `api/codes/use/route.ts`: OpenAPI description mentions the replay (no schema change beyond the shared validator).
- Tests: `commands/__tests__/codes.test.ts`, `lib/__tests__/code-service.test.ts` (`useCode`, `revertCodeUse`), `lib/__tests__/promotions-service.test.ts` (facade dispatch + optional member), `__integration__/TC-PROM-090-code-use-replay.spec.ts`.
- `UPGRADE_NOTES.md`, SPEC-055 changelog row.

## Non-goals

- `reinstateCodeUse`, its imports, its tests and the `promotions.code.exhausted` emit (PR1c).
- Every delivery (`delivery_method` / `DELIVERY_DISCOUNT`) hunk (PR2).
- The order-lifecycle subscribers (PR1b). `revertCodeUse` has no caller until PR1b.

## Must keep (card)

- Early return on a prior non-reverted usage; `revertedAt: null` written on every new `CodeUsage`.
- The replay re-check inside the `Code` row lock.
- Per-row `PESSIMISTIC_WRITE` lock and `revertedAt: null` re-check in `revertCodeUse`.
- Reactivate only an exhausted static code (`wasExhausted && hasRemainingGlobalUses`).

## Audit findings and decisions that concern this step

From `.ai/analysis/pre-implement-SPEC-055-2026-02-23-promotions-module-release-5.md` and SPEC-055 changelog 2.5.0:

- **B1 / S1 → D-R5-PR6:** `revertCodeUse` was a required member of the DI-replaceable `PromotionsService` in the reference. Ported as optional `revertCodeUse?`; the built-in facade still implements it. Covered by the `promotions-service.test.ts` "optional member" case.
- **B2 / S2 / G7:** the `codes/use` replay is a behaviour change of a shipped route and was undocumented in the reference. Documented in `UPGRADE_NOTES.md` and in the route's OpenAPI description; the spec text already carries it (§API Contracts "Replay", §Code Lifecycle "Replay key"). The checkout spec's §7.2 step 6c ("MUST pass `orderId`") is outside this PR.
- **B3:** fresh migration timestamp — `Migration20261119224920_promotions` sorts after main's `Migration20261027113557_promotions`; the reference's `Migration20261026161603` name is not used. Pre-migration rows keep `cart_id`/`order_id` NULL and are never reverted (UPGRADE_NOTES). No encryption map for `promotions`, so no backfill.
- **S3:** `revertCodeUse` reactivates a static code only when it was exhausted before the decrement — kept as in the reference; spec §Code Lifecycle already says so.
- D-R5-PR1…5, PR7, PR8 concern PR1b, PR1c and PR2 only.

## Differences from the card (rule R4: spec wins)

- The binding plan `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md` (rules R1–R14, card PR1a) was **not available** in the primary checkout or any git ref. The user told the run to proceed autonomously, so this run follows SPEC-055's PR1a row, the D-R5-PR* decisions and the card text quoted in the task brief. Rule R5 ("migration generated per R5") could not be read: the migration SQL is taken byte-for-byte from the reference `Migration20261026161603_promotions` with only the class/name timestamp changed (per `packages/core/AGENTS.md` "author a scoped SQL migration" exception), and the snapshot block from the reference.
- Spec §Release 5 acceptance RA1 lists `TC-PROM-090` (HTTP replay) for PR1a; the card's gate lists only unit suites. Added `TC-PROM-090`.
- Spec RA4 names `promotions-service.test.ts`; the card does not. Added facade dispatch and optional-member cases there. "Each caller's test" in RA4 belongs to PR1b (no caller yet).
- Card gate: "UPGRADE_NOTES entry … (and `revertCodeUse` if kept required)" — it is optional, so the entry documents it as additive.

## Risks

- `codes/use` replay is live at once: a caller that omits `orderId` and intentionally uses the same code twice for one cart now gets the second use for free (documented; checkout must pass `orderId`).
- Full integration suite and `yarn build:app` depend on a runnable environment; recorded in `final-gate-checks.md`.
