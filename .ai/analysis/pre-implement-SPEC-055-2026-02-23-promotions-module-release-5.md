# 🔍 Pre-implementation analysis: SPEC-055 Promotions Module, Release 5 amendments

**Readiness: no-go.** The spec covers about half of what the reference ships. It does not describe reinstating usage on `sales.order.confirmed`, the system re-cancel ("refusal") policy, the `promotions.usage.reinstate_blocked` notification, the `sales.order.deleted` revert or the stale-event fences. If PR1b/PR1c were ported now, an automatic order cancellation, a new frozen notification type and a changed meaning for a frozen event id would ship with no contract behind them.

Spec: `.ai/specs/SPEC-055-2026-02-23-promotions-module.md` (v2.3.0 + v2.4.0, branch `feat/r5-spec-revision`), audited 2026-11-19 against `BACKWARD_COMPATIBILITY.md` (repo root) with the built-in template (`.ai/specs/AGENTS.md` checklist). Scope: C5 (`revertCodeUse`, idempotent `useCode`), the order-lifecycle usage subscribers, and D-R5-17 (delivery promotions). Code compared: `main` (worktree HEAD `5d93cbd8bf`) and the reference `refs/remotes/pr/8268` = `bdb747c36a` (base `b7b5309ccc`). Steps follow `.ai/plans/2026-11-19-ecommerce-release-5-relanding-plan.md`: PR1a, PR1b, PR1c, PR2.

**Per-step readiness** (the overall verdict is the worst of these):

| Step | Readiness | Why |
|---|---|---|
| PR1a: reversal primitives, idempotent `useCode` | conditional | The spec describes it. Two corrections are needed: `revertCodeUse?` optional (owner decision) and documenting the `codes/use` replay. |
| PR1b: revert on `.cancelled` / `.deleted` | conditional, after spec text | The cancel path is in the spec. The delete path, the advisory lock and the status fences are not, and the spec says the subscriber "reads only the event payload", which the reference contradicts. |
| PR1c: reinstate, refusal, notification | **no-go** | None of it is in the spec. The refusal policy (automatic order cancellation) has no owner decision. It also changes the meaning of the frozen event `promotions.code.exhausted`. |
| PR2: delivery promotions | conditional | The spec describes it. Three things are open: the HTTP `evaluate` contract, the net/gross basis of `deliveryCost`, and stale docs. |

## ⛔ Blocking before implementation

1. **Reinstate on confirmation is not in the spec** (PR1c). Add a "Usage reinstatement" block covering `order-confirmed-usage-reinstate.ts`, `PromotionUsageService.reinstateUsage`, `PromotionCodeService.reinstateCodeUse`, their refusal rules (cap, claimed voucher, budget) and `blockedCount`. See [Gaps G1](#-gaps).
2. **The refusal policy is not in the spec and has no owner decision** (PR1c). The policy re-cancels a revived order through `sales.orders.update` with a system actor and a `beforeTransactionalWrite` fence. Record the owner's acceptance (or the alternative) and specify it. See [Decisions D1](#️-decisions-for-the-spec-owner).
3. **New frozen notification type and the meaning of `promotions.code.exhausted` are not in the spec** (PR1c, BC §5/§11). The reference emits `code.exhausted` only for a refused reinstatement, with a payload different from the one the spec documents. Spec Phase 4 step 2 reserves that event for code-pool exhaustion. Decide the event's meaning, then specify the payload and the `reinstate_blocked` notification. See [BC B4/B5](#-backward-compatibility) and [Decisions D2](#️-decisions-for-the-spec-owner).
4. **The spec mis-describes the PR1b subscriber.** It says the subscriber "reads only the event payload's `orderId`/`tenantId`/`organizationId`" and covers `sales.order.cancelled` only (§Code Lifecycle). The reference also subscribes to `sales.order.deleted`, takes a `pg_advisory_xact_lock`, and reads `sales_orders.status`/existence with raw SQL before acting. Rewrite the paragraph and the file tree. See [Spec vs. reference S4](#spec-vs-reference-implementation).

## ⚠️ Decisions for the spec owner

The owner decisions of 2026-11-19 are treated as settled: `revertCodeUse` becomes optional; pay-link routes fail closed with 503; the `forms` reminder must not fire on invitation creation.

- **D1. What happens when a revived order's usage cannot be reinstated?** Today's reference default is refusal: the subscriber re-cancels the order as a system actor (`order-confirmed-usage-reinstate.ts:58-74`, `:159-198`). The review history records this choice as never confirmed by a maintainer (review-history §2.13, "Decisions no maintainer ever took").
  - Recommendation: accept refusal, which is conservative and reversible because staff can revive the order again. Record it in the spec with three caveats:
    - the re-cancel can be refused by `assertOrderCanBeCancelled` (`sales/lib/orderCancellationGuard.ts`) when payments are held or shipments exist;
    - the order then stays confirmed with an unbacked discount;
    - the notification must say so.
  - Tradeoff: the alternatives are repricing a confirmed order (billing and compliance risk) or a ledger-only overrun (no fix to the order total).
- **D2. What does `promotions.code.exhausted` mean?** The spec says the event fires when a code pool drops to zero after `codes/use`, with payload `{organizationId, tenantId, codeId, codeName}` (§Commands & Events). Phase 4 builds a pool-exhaustion notification on it. The reference emits it only from `reinstateCodeUse`, with `{orderId, codeId, generatedCodeId, reason, tenantId, organizationId}` (`code-service.ts:778-800`). Its notification subscriber skips any event without `orderId`, so a future pool-exhaustion emit would be dropped silently.
  - Recommendation: keep the id. Document one superset payload, `{organizationId, tenantId, codeId, codeName?, orderId?, generatedCodeId?, reason: 'pool_exhausted' | 'generated_code_claimed' | 'code_cap_exceeded'}`, and route on `reason`. This is a small change to the reference (add `codeName`), not a redesign.
  - Alternative: a new id, `promotions.code.reinstate_refused`. It is cleaner, but it changes the reference more.
- **D3. Durability of the lifecycle subscribers.** `sales` emits `sales.order.cancelled`, `.confirmed` and `.deleted` without `{ persistent: true }` (`sales/commands/documents.ts` `emitOrderLifecycleEvent`; `packages/shared/src/modules/events/factory.ts:350-397` forwards options unchanged). A `persistent: true` subscriber therefore runs inline, and the bus logs and swallows its error (`packages/events/src/bus.ts:416-460`). The reference's "throw so the queue retries" comments (`order-cancelled-usage-revert.ts:164-177`, `order-confirmed-usage-reinstate.ts:178-181`) are wrong: a transient failure loses the revert, the reinstate or the refusal for good.
  - Option 1: make the `sales` lifecycle emits persistent. This is a change to persistent delivery semantics and needs approval first under `packages/events/AGENTS.md`. It also affects the `wms` and `customer_groups` subscribers.
  - Option 2: accept best-effort delivery and add a reconciliation sweep later.
  - Recommendation: Option 1, decided together with SA2a and CG5b. Either way, the spec must stop implying redelivery.
- **D4. Revival through a non-confirmed status.** Reinstatement fires only on `sales.order.confirmed`, which is emitted only when the status becomes `confirmed` (`documents.ts:1030-1088` at the reference). An order moved from `canceled` to `draft`, `sent`, `in_fulfillment`, `fulfilled` or `on_hold` (all seeded in `sales/lib/dictionaries.ts:188-199`) is live again, but its code stays free and its budget stays released. This is the #9073/#8817 class of bug again.
  - Recommendation: reinstate on any transition out of a cancelled status, for example by also subscribing to `sales.order.updated` with the same state-based handler (the handler is already idempotent and keyed on state). Or document the gap explicitly as accepted.
- **D5. Should the delivery context be exposed over HTTP?** §API Contracts shows `deliveryMethodCode`/`deliveryCost` in the `POST /api/promotions/evaluate` body. That route parses the `.strict()` `evaluateInputSchema` (`data/validators.ts:1053-1063` on main), which the reference does not touch (`:1087` at the reference), so an HTTP caller sending these fields gets a validation error.
  - Recommendation: in-process only for Release 5 (checkout is the only caller). Mark the two JSON lines "in-process `EvaluateInput` only; not accepted by the HTTP route".
  - Alternative: add both fields as optional to the schema (additive under BC §7).
- **D6. Scope split.** PR1c (refusal policy, notification, event semantics) can ship independently of PR1a, PR1b and PR2. The plan already splits it out. Recommendation: land the spec text for PR1a, PR1b and PR2 now, and keep PR1c on hold until D1–D4 are decided.

## 📋 Readiness gate

| # | Item | Result | Evidence / fix |
|---|------|--------|----------------|
| R1 | Declared status | ✅ | `Status: Approved` with the v2.3.0 and v2.4.0 amendments. |
| R2 | No blocking open questions | ❌ | The spec has no Open Questions block, but D1 (refusal) and D2 (`code.exhausted` meaning) are open owner decisions that PR1c's behaviour depends on (review-history §2.13; plan card PR1c "Record the owner's acceptance"). |
| R3 | Traceability | ❌ | The Release 5 amendments live only in the changelog and prose. No acceptance criterion or `TC-PROM-*` oracle exists for revert, replay, reinstate, refusal, delete or delivery. PR1c has no requirement at all. Fix: add a "Release 5 acceptance" list (see G5) that maps to the plan cards' Gates. |
| R4 | Contracts defined | ❌ | Undefined: the `sales.order.deleted` and `sales.order.confirmed` subscribers, `reinstateUsage`/`reinstateCodeUse`, the refusal command call and its fence, `promotions.usage.reinstate_blocked` (recipients, copy, link), the `code.exhausted` payload, `origin` on `budget_exhausted`, and the `codes/use` replay response. |
| R5 | Phases deliverable | ✅ | The spec's Implementation Plan has no Release 5 phase. The relanding plan cards PR1a, PR1b, PR1c and PR2 give each step its dependencies, an exit gate and "Inert until" notes. Acceptable, as long as the spec references them. |
| R6 | Grounded in the codebase | ❌ | See S4 (subscriber "reads only the payload"), G9 (rule count "twelve": main ships 8 rule types, so 9 after PR2, `data/validators.ts:314-323`), and the stale "greenfield" Migration & Compatibility section (`:1330-1337`). |

## 💥 Backward compatibility

| # | Surface (BC doc) | Step | Change | Severity | Migration path |
|---|---|---|---|---|---|
| B1 | §9 DI service interface | PR1a | Spec (`:1764`) and reference (`lib/types.ts:148`) add `revertCodeUse` as a required member of the DI-replaceable `PromotionsService` | Warning | The owner decided `revertCodeUse?`. Change both the spec and the reference. The facade in `promotions-service.ts` still implements it. |
| B2 | §7 API route behaviour | PR1a | A second `POST /api/promotions/codes/use` with the same `(codeId, cartId, orderId ?? null)` returns `{ ok: true }` without consuming the code or checking eligibility (`code-service.ts:405-460`); the body gains optional, nullable `orderId` | Warning | Document it in §API Contracts and in `UPGRADE_NOTES.md` (the reference has no entry). |
| B3 | §8 Database schema | PR1a | `promotion_code_usages` gains `cart_id`, `order_id`, `generated_code_id` (FK, on delete set null), `reverted_at`, plus two indexes | additive, OK | Use a fresh migration timestamp: the reference's `Migration20261026161603` sorts before main's `Migration20261027113557_promotions`. Pre-migration rows keep `cart_id = NULL` and can never be reverted; document that. No encryption map exists for `promotions`, so #8893 does not apply. |
| B4 | §5 Event IDs and payloads | PR1c | First emission of `promotions.code.exhausted`, with semantics and payload different from the spec (D2) | Warning | Use a superset payload with `reason`. Add a dated §Commands & Events row and an `UPGRADE_NOTES.md` entry. |
| B5 | §11 Notification type IDs | PR1c | New `promotions.usage.reinstate_blocked`, which becomes frozen once it ships | Warning (not in spec) | Specify the id, recipients, copy and link before porting. The name cannot change afterwards. |
| B6 | §5 Event payloads | PR1c | `promotions.promotion.budget_exhausted` gains `origin`. `promotions.usage.registered` is now also emitted on reinstate (`promotion-usage-service.ts:366-369`) | additive, OK / Warning | Document `origin` and the second trigger of `usage.registered`. The spec's own payload for `budget_exhausted` (`{maxBudget, totalDiscountGranted, budgetCurrency}`) already differs from main's `{promotionId, orderId, tenantId, organizationId}`; fix the row. |
| B7 | §2 Exported types | PR2 | The literal types of `RELEASE_4_SHIPPED_RULE_TYPES`/`_BENEFIT_TYPES` grow, `PROMOTIONS_HIDDEN_BENEFIT_TYPES` becomes `readonly []`, and the `RuleTypeId`/`BenefitTypeId` unions grow | Warning | Third-party `Record<RuleTypeId, …>` maps, or `.includes(str)` on an empty tuple, stop compiling. Add an `UPGRADE_NOTES.md` line. |
| B8 | §7 API routes | PR2 | `PUT /api/promotions/[id]/tree` accepts `delivery_method`/`delivery_discount`; `POST /api/promotions/evaluate` is unchanged | additive, OK | Fix the HTTP body contradiction (D5). |
| B9 | §1, §14 Auto-discovery / generated | PR1b, PR1c | Five new subscribers and `notifications.ts` | additive, OK | Run `yarn generate`; update the notification-registry count in `apps/docs`. |
| B10 | §3 Function signatures, §4 Import paths, §6 Widget spots, §10 ACL features, §12 AI ids, §13 CLI commands | all | untouched; `promotions.usage.manage` is reused as the notification gate | none | |
| B11 | Migration section | all | §Migration & Compatibility (`:1330-1337`) still calls the module greenfield, but Release 5 changes shipped surfaces | Warning | Add a "Release 5 (2026-10-26)" bullet listing B1–B8. |

## 📝 Spec completeness

| Section | Missing / incomplete | Impact | What to add |
|---|---|---|---|
| Architecture file tree (`:174-180`) | Lists `invalidate-promotion-cache.ts` and `budget-exhausted.ts`; main has eight `invalidate-*` files. Missing: `order-deleted-usage-revert.ts`, `order-confirmed-usage-reinstate.ts`, `*-notification.ts`, `notifications.ts`, `lib/usageAccountingNotifications.ts` | Implementers port from the reference with no spec to check against | The real file list |
| Promotion Usage Lifecycle (`:326-354`) | No `reinstateUsage`; `revertUsage`'s signature is listed as `(orderId, organizationId, tenantId)` but is really `(em, input, scope)` | PR1c contract undefined | Method row, budget re-read under the row lock, and the refusal semantics |
| Risks & Impact Review | No Release 5 risks (lifecycle races, refusal, non-durable events, revival gaps) | Risks D3/D4 are invisible to reviewers | Rows R1–R5 from the Risks table below |
| Test coverage | No `TC-PROM-*` ids for any Release 5 path; the tree builder's new options have no UI coverage ("QA does", plan PR2) | Breaks the root `AGENTS.md` rule "spec MUST list integration coverage" | See G5 |
| Final Compliance Report (`:1586`) | Still says delivery and delivery-discount are hidden | Stale | Update the row |

## 🔍 Repo-rule compliance

| Rule (source) | Location | Fix | Severity |
|---|---|---|---|
| "Never rely on payload-provided tenant or organization scope when trusted scope is available" (`packages/events/AGENTS.md`) | Reference subscribers read `payload.tenantId ?? ctx.tenantId` (`order-cancelled-usage-revert.ts:64-65`, `order-confirmed-usage-reinstate.ts:248-249`, `budget-exhausted-notification.ts:44-45`) | Prefer `ctx.tenantId`/`ctx.organizationId` and fall back to the payload only when they are null. Today `sales` passes no trusted options, so the payload remains the source. | Important (b) |
| Tenant/organization isolation (root `AGENTS.md`, Never) | `createUsageReinstateBlockedNotification` calls `createForFeature` without `restrictRecipientsToOrganization` (`lib/usageAccountingNotifications.ts:28-38`), so every holder of `promotions.usage.manage` in the tenant, in every organization, is notified about another organization's order id (`notificationService.ts:514-545`) | Pass `restrictRecipientsToOrganization: true`, as `ecommerce/lib/storeNotifications.ts:51` and `staff` do | Important (b) |
| "Cache invalidation after commit (never inside `withAtomicFlush`)" (spec Phase 1 step 5) | `revertCodeUse`/`reinstateCodeUse` call `invalidateCrudCache` and emit persistent events, but inside the subscriber's outer `em.transactional` (`order-cancelled-usage-revert.ts:103-163`, `order-confirmed-usage-reinstate.ts:211-242`). A concurrent reader can re-cache pre-commit state, and an event can fire for a rolled-back write | Collect the invalidations and events, then flush them after the outer transaction commits, or accept the risk and document it | Important (b) |
| Command pattern for financially consequential writes (spec §A.2a) | The subscribers call `revertUsage`, `revertCodeUse` and `reinstate*` directly, not through the command bus, so there is no audit-log entry for a system reversal | Accept and document "system path, no audit log", or route through the commands | Nice-to-have (c) |
| Cross-module coupling (`packages/core/AGENTS.md`) | Raw SQL on `sales_orders` and Kysely on `dictionaries`/`dictionary_entries` (`order-confirmed-usage-reinstate.ts:75-96`, `:116-128`); executes `sales.orders.update` | Acceptable: no import, and it only runs on `sales` events. The spec must say so (S4) | Important (a) |
| Real DI container for nested commands (review R27–R29; owner decision on subscriber containers) | The refusal passes the resolve-only `{ resolve }` container into `sales.orders.update` (`order-confirmed-usage-reinstate.ts:183-197`) | Gate PR1c on F2 (real container), or prove `sales.orders.update` needs only `resolve` | Important (b) |

## ⚠️ Risks

| Risk | Level | Impact | Mitigation |
|---|---|---|---|
| R1. Lifecycle events are inline-only (D3). A failed revert, reinstate or refusal is never retried | High | A single-use code stays consumed for a cancelled order, or stays free for a live one; budget drifts | D3 option 1, or a reconciliation sweep. Fix the "retry" claims in code and spec |
| R2. Revival through a non-confirmed status (D4) | High | A code is redeemable twice while the first order is fulfilled | Reinstate on any exit from a cancelled status |
| R3. A refusal cancel blocked by `assertOrderCanBeCancelled` (held payment or shipment) | Medium | The order stays confirmed with an unbacked discount; only telemetry shows it | Notify with outcome-specific copy; spec D1 caveat |
| R4. The refusal event and notification are emitted inside the reinstate transaction, before the outcome is known. The copy says the order "is being automatically returned to cancelled" (`i18n/en.json:273` at the reference) even when `RefusalSupersededError` cancels nothing or the cancel fails | Medium | Staff are told an order was cancelled when it was not | Emit after the refusal outcome; use two copies (cancelled / could not cancel) |
| R5. PR1b without PR1c: a revived order keeps its code free (#8817) | Medium | Double redemption between releases | Plan release rule: PR1c merges right after PR1b, before any release. A no-go on PR1c therefore also holds PR1b |
| R6. The notification subscriber treats a missing `origin` as `reinstate` (`budget-exhausted-notification.ts:48`) | Low | `budget_exhausted` jobs queued before the upgrade by main's `registerUsage` (which carry no `origin`) raise false alerts | Treat a missing `origin` as `register`, or drain the queue on deploy |
| R7. `useCode` replay key includes `orderId ?? null`, so HTTP callers that omit `orderId` share one key per cart | Low | A second legitimate HTTP use for the same cart is silently not consumed | Document it; checkout always passes `orderId` (reference `checkout/commands/submit.ts:1850-1857`) |
| R8. Order cancelled and then deleted: the cancel fence sees no row and skips; the revert relies on the delete event, which main never emits (SA2a) | Low | Until SA2a, usage stays registered when delete follows cancel faster than inline delivery | SA2a before PR1b, or accept for the short window |

## 🔍 Gaps

- **Critical G1**: the reinstatement contract (Blocking 1). Specify:
  - the event and the state gate: the order exists and is not cancelled under either spelling, read on the lock transaction (`tx.execute`);
  - no `previousStatus` gate (#9073);
  - the per-row refusal rules: `reinstateCodeUse` refuses a claimed `GeneratedCode` or a code at its cap (`code-service.ts:689-810`); `reinstateUsage` re-reads the budget under the `Promotion` row lock (`promotion-usage-service.ts:306-372`);
  - idempotency through `revertedAt IS NOT NULL` lookups.
- **Critical G2**: the refusal policy and its fence (Blocking 2, D1): `sales.orders.update` with `statusEntryId` set to the tenant's `canceled` entry, a trusted system context, and a `beforeTransactionalWrite` fence that takes the same lock and re-checks status and outstanding reverted usage. Also specify `RefusalSupersededError` handling (acknowledge) and what happens when the "canceled" entry is missing (throw, which is ineffective without D3).
- **Critical G3**: `promotions.usage.reinstate_blocked`: in-app, severity warning, 168 h, gated by `promotions.usage.manage` with organization-restricted fan-out, link `/backend/sales/orders/<id>`, `groupKey`, and title/body keys in five locales. Plus the `code.exhausted` and `budget_exhausted` contract (Blocking 3, D2).
- **Critical G4**: the delete path and the fences in §Code Lifecycle (Blocking 4):
  - `sales.order.deleted` uses the same handler and skips when the order row exists again (undo);
  - lock `promotions_usage_lifecycle:<orderId>`;
  - a cancel event reverts only when the order is cancelled now;
  - a `sales.order.deleted` emitter exists only after SA2a (main emits none; `sales/events.ts:29` declares it).
- **Important G5**: Release 5 acceptance and tests. Add `TC-PROM-*` ids for:
  - `codes/use` replay (no double consume, concurrent replay);
  - `revertCodeUse` (static, dynamic, admin-deactivated code stays off, cross-tenant);
  - cancel/delete revert, redelivery, stale events;
  - reinstate, refusal, notification;
  - `delivery_method` match/no-match/absent context;
  - `delivery_discount` fixed/percentage/clamp/single currency;
  - the tree builder UI offering both new types and saving them. The reference's unit and real-Postgres suites (plan PR1c Gate) are the oracles to cite.
- **Important G6**: the basis of `deliveryCost`. The spec never says whether it is net or gross. `resolveDeliveryDiscount` uses it as both bases and sets `basis: 'net'` (`effect-resolvers.ts:432-457` at the reference), so `amountNet === amountGross`. When shipping is taxed, either the gross discount or the budget (`|amountNet|`, §Data Models) is wrong. Specify the input pair (`deliveryCostNet`/`deliveryCostGross`, or a single figure with a declared basis) together with the checkout spec's §5.4 (reference caller `checkout/commands/delivery.ts:129,151` passes a single `selected.cost`).
- **Important G7**: the replay semantics of `useCode` are missing from §Code Lifecycle and §API Contracts `codes/use` (B2). Also state that the checkout caller MUST pass `orderId`, since the cancel subscriber reverts by `orderId` only. The checkout spec's §7.2 step 6c (`2026-03-19-checkout-simple-checkout.md:479`) still omits it; tell the checkout auditor.
- **Important G8**: `revertCodeUse` reactivation. The spec says "reactivate once headroom returns" (`:301-302`). The reference reactivates only a code that was exhausted before the decrement, so an admin-deactivated code with headroom stays off (`code-service.ts:646-648`). Change the spec.
- **Important G9**: spec drift on the rule count:
  - `:483` says "twelve as of Release 5", but main ships 8 rule types (2.2.3 hid three), so the count is 9 after PR2;
  - `:1343`, `:1351`, `:1361`, `:1373` and `:1586` still say "eleven";
  - the PR2 docs left stale by the reference (`apps/docs/docs/api/promotions.mdx`, `promotions/AGENTS.md:60`, the `TC-PROM-073` header) must be listed in the step.
- **Nice-to-have G10**: `deliveryMethodCode` is a free-text field in both rule and benefit cards (`ruleFieldSpecs.ts` at the reference). A typo produces a promotion that never matches, with no error. Name the vocabulary (the `sales` shipping-method `code`) and plan a picker later.
- **Nice-to-have G11**: `revertCodeUse({ cartId })` reverts every unreverted use for that cart, including uses from an earlier order on the same cart. State that `orderId` is the preferred key.

## Spec vs. reference implementation

(a) the spec should change · (b) the reference must change when ported · (c) owner decision.

| # | Topic | Spec says | Reference does (`bdb747c36a`) | Class |
|---|---|---|---|---|
| S1 | `PromotionsService.revertCodeUse` | Required member (`:1764`) | Required (`promotions/lib/types.ts:148`) | (a)+(b): make it optional (`revertCodeUse?`), per the owner decision |
| S2 | `useCode` replay | Not described | Fast-path and in-lock idempotency on `(codeId, cartId, orderId ?? null, revertedAt null)` (`code-service.ts:405-460`) | (a) |
| S3 | `revertCodeUse` reactivation | "Reactivate once headroom returns" (`:301`) | Only when the code was exhausted before the decrement (`code-service.ts:646-648`) | (a) |
| S4 | The PR1b subscriber's inputs | "Reads only the event payload's `orderId`/`tenantId`/`organizationId`" (`:323`) | Also reads `sales_orders` (status, existence) with raw SQL under `pg_advisory_xact_lock` (`order-cancelled-usage-revert.ts:101-151`) | (a) |
| S5 | `sales.order.deleted` revert | Absent | `order-deleted-usage-revert.ts:19-27`, skip-if-row-exists fence (`order-cancelled-usage-revert.ts:106-123`) | (a) |
| S6 | Reinstate on `sales.order.confirmed` | Absent | `order-confirmed-usage-reinstate.ts` (321 lines), `reinstateUsage`, `reinstateCodeUse` | (a) for the contract; (c) for revival via other statuses (D4) |
| S7 | Refusal: re-cancel the revived order | Absent | `order-confirmed-usage-reinstate.ts:58-198` via `sales.orders.update` and the fence | (c) D1, then (a) |
| S8 | `promotions.code.exhausted` | Pool exhaustion on `codes/use`, `{organizationId, tenantId, codeId, codeName}`; Phase 4 notification | Emitted only on a refused reinstatement, `{orderId, codeId, generatedCodeId, reason, tenantId, organizationId}` (`code-service.ts:778-800`); never on pool exhaustion | (c) D2 |
| S9 | `budget_exhausted` payload | `{…, maxBudget, totalDiscountGranted, budgetCurrency}` (`:380`) | `{promotionId, orderId, tenantId, organizationId, origin}` (`promotion-usage-service.ts:73-95`) | (a); the drift predates Release 5 |
| S10 | Notification type | Phase 4 plans `notifications.ts` for code exhaustion and expiring soon (`:1407`) | Ships `promotions.usage.reinstate_blocked` now (`notifications.ts:10-22`) | (a) |
| S11 | Notification audience | n/a | Tenant-wide fan-out (`usageAccountingNotifications.ts:28-38`) | (b): restrict to the organization |
| S12 | Retry on failure | "Persistent subscriber … redelivery" (`:318-320`) | Rethrows expecting a retry; the emit is not persistent, so nothing retries | (c) D3, then (a)+(b) |
| S13 | Cache invalidation timing | After commit (`:1353`) | Inside the outer subscriber transaction | (b) or (a) document |
| S14 | Scope source | n/a (events rule) | Payload before `ctx` | (b) |
| S15 | Refusal notification copy | n/a | "is being automatically returned to cancelled", emitted before the outcome is known | (b) |
| S16 | HTTP `evaluate` delivery fields | In the request body (`:781-782`) | Strict schema unchanged; in-process only | (c) D5, then (a) or (b) |
| S17 | `deliveryCost` basis | Unspecified | Used as both net and gross base, `basis: 'net'` (`effect-resolvers.ts:432-457`) | (a)+(b) G6 |
| S18 | `max_discount` and caps on `delivery_discount` | "`max_discount` does not apply" | The config schema has no `maxDiscount` but keeps `...quantityCapShape` (main `validators.ts:511-520`); `appliesTo` is `order` only | (a): say that caps are accepted but meaningless, or (b) drop `quantityCapShape` |
| S19 | Rule-type count | "twelve" (`:483`) | 9 shipped (`validators.ts:323` at the reference) | (a) |
| S20 | Migration name | `Migration20261026161603_promotions` (changelog 2.3.0) | Same; sorts before main's `Migration20261027113557` | (b): fresh timestamp when ported, update the changelog |

## 📋 Remediation plan

1. **Before implementation** (spec edits on this branch):
   - Add the Release 5 blocks for G1–G4, plus the PR1a corrections S1–S3 and G7.
   - Rewrite the §Code Lifecycle subscriber paragraph and the file tree (S4, S5, S10).
   - Decide D1 and D2, then fix §Commands & Events (S8, S9, B6).
   - Add the Release 5 bullet to §Migration & Compatibility (B11) and the Release 5 rows to Risks.
   - Add the G5 test list.
   - Resolve D5 and G6 for PR2.
   - Fix the counts (G9).
   - PR1a and PR2 can start as soon as their own items (S1–S3, G7; D5, G6, G9) are in. PR1b and PR1c wait for G1–G4 and D1–D4.
2. **During implementation** (add to each PLAN.md):
   - PR1a: `revertCodeUse?` optional; fresh migration timestamp; `UPGRADE_NOTES.md` entry for the replay.
   - PR1b: prefer trusted `ctx` scope; do not claim retry unless D3 lands; one `UPGRADE_NOTES.md` entry.
   - PR1c:
     - `restrictRecipientsToOrganization: true`;
     - emit the refusal events and notification after the outcome, with two copies;
     - treat a missing `origin` as `register`;
     - prove the nested command under the real container (F2) or show `resolve` is enough;
     - flush cache invalidations and events after the outer commit.
   - PR1c prerequisites not on main today: F1 (`buildTrustedCommandContext`: `packages/shared/src/lib/commands/` has no `trusted-context`) and SA2a (`beforeTransactionalWrite` is not called in `sales.orders.update`; `sales.order.deleted` has no emitter).
   - PR2: an optional `deliveryCost` basis, or a net/gross pair; update the stale docs.
3. **After implementation** (follow-up): a reconciliation sweep for reverted/unreverted drift if D3 option 2 is chosen; a delivery-method picker (G10); the audit-log path for system reversals; re-test #8426, #8817, #9073 (promotion half) and #8406 when the steps land.

## 🧪 Audit limits

- Compared main (worktree HEAD) and `refs/remotes/pr/8268` for `packages/core/src/modules/promotions/**`, the relevant hunks of `sales/commands/documents.ts`, the checkout caller (`packages/checkout/.../submit.ts`, `delivery.ts`), `packages/events/src/bus.ts`, `packages/shared/src/modules/events/factory.ts`, `notifications/lib/notificationService.ts`, and the `sales` order-status seeds.
- Reference test files were inventoried, not read line by line. Nothing was executed (no typecheck, no tests).
- Whether `sales.order.updated` is emitted on a status change (needed for the D4 recommendation) was not verified.
- Whether `sales.orders.update` needs more than `resolve` from its container (refusal path) was not verified.
- Line numbers marked "at the reference" are taken from `git show refs/remotes/pr/8268:<path>`; the others are from main.
- Encryption (#8893): `promotions` has no `encryption.ts`, and the new columns are ids/timestamps, so no backfill migration is needed.
- No `knowledge.sources` or `.uxproof/` were configured or loaded. No prompt-injection content was found.
