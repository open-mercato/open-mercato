# Marketing automation phase 1c — QA fixes

## Goal

Resolve the 2026-10-25 QA NO-GO on PR #7422 (`phase/1c-dispatch`): make the public tracking/unsubscribe
routes default to "not ready" in both shipped `.env.example` files, resolve customer placeholders in
`notify` step messages, drop the notify step's dead link to a later-phase screen, narrow the save-time
loop guard so a tag-triggered campaign can still tag its own subjects with a different tag, and stop a
refused send from reporting its run as `completed`.

## Scope

- `apps/mercato/.env.example`, `packages/create-app/template/.env.example`: flip
  `OM_MARKETING_PUBLIC_ROUTES_READY` to `false` (F-1 / #7955).
- `steps/notify.ts`: resolve `{{customer.displayName}}` and the rest of `COPY_PLACEHOLDERS` in the
  authored message via the same `loadRenderValues`/`neededRenderRoots` path `send-email` already uses
  (F-2 / #7956); drop the `linkHref` that pointed at a customer/campaign screen this phase does not ship
  (F-3, not filed).
- `commands/campaigns.ts`: narrow `assertNoLoopRisk`'s `add_tag` carve-out so it only refuses a step
  whose own tag cannot be ruled out by the campaign's audience, instead of refusing every `add_tag` step
  in any tag-triggered campaign (not filed).
- `steps/send-email.ts`, `steps/nps-survey.ts`: throw instead of returning `{status: 'skipped'}` on the
  two configuration-fault guards (no unsubscribe URL, public routes not ready / no tracking secret), so
  the executor's existing `failed` → retry → `dead` path applies instead of the run silently completing
  (not filed).

Non-goals (explicitly out of scope, left for the author to decide with full context):

- **Consent default.** `UNRECORDED_CONSENT_ALLOWS_SENDING = true` is a deliberate, spec-documented
  product decision (`lib/consent.ts`, `.ai/specs/2026-09-28-marketing-automation-module.md` §304-319):
  flipping it would silently disable every campaign on every installation without a consent import.
  QA raised it but did not file it; not changed here.
- Any UI/screen work — phase 1c ships none, and none of QA's findings need one.
- Re-touching anything QA marked ✅ (B2, M1, M5, M7 from the prior review; all fourteen QA scenarios
  except #3 and #7).

## Implementation Plan

### Phase 1: Shipped defaults and personalization

1.1 Flip `OM_MARKETING_PUBLIC_ROUTES_READY` to `false` in both `.env.example` files.
1.2 Route `notify` step messages through `loadRenderValues`/`neededRenderRoots`; drop its dead `linkHref`.

### Phase 2: Loop guard and run status

2.1 Narrow the `add_tag` loop-guard carve-out in `commands/campaigns.ts` to the provably-safe case.
2.2 Make `send-email.ts` and `nps-survey.ts` throw on their configuration-fault guards instead of
    returning `skipped`.

### Phase 3: Verification and delivery

3.1 Update/add unit tests for every behavior change above.
3.2 Run the repository validation gate.
3.3 Run the authoritative `om-auto-review-pr` pass and finalize the PR.

## Risks

- The loop-guard narrowing is a soundness-sensitive static analysis over the platform's generic
  condition-expression tree (`business_rules`); it is deliberately conservative (falls back to the old
  blanket refusal whenever it cannot prove the tag is safe) rather than attempting full boolean-expression
  reachability analysis.
- Converting a `skipped` step outcome to a throw changes the public-facing run status for that run
  (`completed` → eventually `dead` after retries) — reusing the executor's existing, already-bounded
  (5 attempts) retry/dead-letter path rather than introducing a new run status.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shipped defaults and personalization

- [x] 1.1 Flip `OM_MARKETING_PUBLIC_ROUTES_READY` to `false` in both `.env.example` files. — 28e66ffa8
- [x] 1.2 Route `notify` step messages through `loadRenderValues`/`neededRenderRoots`; drop its dead `linkHref`. — 28e66ffa8

### Phase 2: Loop guard and run status

- [x] 2.1 Narrow the `add_tag` loop-guard carve-out in `commands/campaigns.ts` to the provably-safe case. — 28e66ffa8
- [x] 2.2 Make `send-email.ts` and `nps-survey.ts` throw on their configuration-fault guards instead of returning `skipped`. — 28e66ffa8

### Phase 3: Verification and delivery

- [x] 3.1 Update/add unit tests for every behavior change above. — 28e66ffa8
- [x] 3.2 Run the repository validation gate. — build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck and build:app all green; `yarn test` is green for every package touched here (marketing-automation: full suite pass) — the one unrelated failure, `create-mercato-app#test`, reproduces in isolation on an unmodified checkout (macOS launcher-path validation and a 120s nested-typecheck timing budget) and is pre-existing, environment-specific flakiness untouched by this change.
- [ ] 3.3 Run the authoritative `om-auto-review-pr` pass and finalize the PR.
