# 🔍 Pre-implementation analysis: Customer Groups & B2B Commercial Terms, Phases 3–4 (eComm Release 5)

**Readiness: no-go.** Five problems would ship as written:

- The money and transaction model the spec prescribes no longer matches `main` or the checkout spec.
- The frozen approval event payload has no audience, so portal users of other companies would receive each approval.
- Decision notes and hold reasons would be stored in plaintext on every tenant that existed before the upgrade.
- The order-lifecycle fixes for two High QA defects have no place in the spec.

All five are spec edits or one owner decision. None needs a redesign.

Spec: `.ai/specs/2026-08-14-customer-groups-and-b2b-terms.md` (Release 5 revision 2026-10-26, D-R5-37).

Audit context:
- Audited 2026-11-19 against `BACKWARD_COMPATIBILITY.md`.
- No spec template exists, so the built-in section set and `.ai/specs/AGENTS.md` were used.
- Code was read at `main` `5d93cbd8bf` and at the reference `refs/remotes/pr/8268` `bdb747c36a` (diff base `b7b5309ccc`).
- Scope: Phase 3 (Credit) and Phase 4 (Approvals): §5.3–§5.6, §6.3, §6.5, §6.6, §7.3–§7.5, §8.4, §9–§11, §13, §14 Phases 3–4.

## ⛔ Blocking before implementation

1. **C1 · The spec describes a money model that `main` dropped on 2026-11-19 (R6).** §5.3 lists the shipped `default_credit_limit`, `approval_required_above` and `min_order_value` as `numeric(16,2)`. Since #7324 (`2066fc61cd`) they are unconstrained `numeric` with `ExactDecimalType` (`customer_groups/data/entities.ts:223-233`). §5.5 names "the minor-unit helpers promotions already uses". `promotions/lib/promotion-usage-service.ts:5-12` now uses `@open-mercato/shared/lib/decimal`. **Fix:** see [Spec completeness](#-spec-completeness), row "§5.4–§5.6 money".
2. **C2 · The transaction model of §6.3 contradicts checkout (R6).** §6.3 and R1 say checkout calls `reserveCredit` inside its own submit transaction and that the service joins it. Checkout §7.2 says each submit step is a separate transaction. The service is also bound to the request `em` (`di.ts`), so it cannot join a transaction that runs on another `EntityManager` in any case. **Fix:** see [Repo-rule compliance](#-repo-rule-compliance), row C2.
3. **C3 · The approval event payload leaks across companies (R4, security).** §10.1 freezes `ApprovalEventPayload` with `portalBroadcast: true` and no audience field. The portal SSE stream scopes delivery by tenant, organization and optional `recipientUserIds` only (`customer_accounts/api/portal/events/stream.ts:74-106,140`). Built as written, every portal user of the organization receives every company's approvals. This was security finding Sec-Medium #10 on #8268, fixed in `2efd2b45b8`. **Fix:** see [Spec vs. reference](#-spec-vs-reference-implementation), row 22.
4. **C4 · No encryption-map backfill (rule violation, #8893 High).** §16 declares four encrypted note columns. §8.4 says "no backfill". `packages/core/AGENTS.md` → Encryption requires a `buildEncryptionMapBackfillSql` migration, and the reference has none (`Migration20261026144220`, `Migration20261026201625`). **Fix:** add to §8.4 and §16 one backfill migration per map, with an empty `down()`:
   - `customer_groups:customer_credit_account` → `hold_reason`
   - `customer_groups:customer_credit_ledger_entry` → `note`
   - `customer_groups:customer_purchase_approval` → `buyer_decision_note`, `merchant_decision_note`

   Use `customers/migrations/Migration20261030195138_customers.ts` as the precedent.
5. **C5 · The order lifecycle is incomplete (Critical gap, owner decision).** §6.5 and §11 release credit only on `sales.order.cancelled`. The reference adds release on `sales.order.deleted` and re-reservation on `sales.order.confirmed` after an undo or a revival (`reinstate:<key>`). These fix #8404 (High), #8406 and #9073. They use a per-order advisory lock and a raw read of `sales_orders.status`. Two open questions block CG5b: whether these belong in the spec, and what happens when a reinstatement is refused (#8819, open). **Fix:** see [Decisions for the spec owner](#️-decisions-for-the-spec-owner), O1.
6. **C6 · Requirements with no test and no implementation (R3).** §10 lists five events that the reference neither declares nor emits, and §13 tests none of them:
   - `credit.reserved`, `credit.released`, `credit.settled`
   - `credit_account.put_on_hold`, `credit_account.released_from_hold`

   §6.5 also promises system audit-log entries for reserve, release, settle and link. None is written (`customerCreditService.ts` has no action-log call). Event ids freeze at ship (§8.4). **Fix:** see [Decisions for the spec owner](#️-decisions-for-the-spec-owner), O2.

Next action: revise the spec with the `om-spec-writing` skill. After that, the Phase 3 steps CG2a–CG3b need no further owner input.

## ⚠️ Decisions for the spec owner

| # | Question | Recommended answer | Tradeoff |
|---|---|---|---|
| O1 | Accept release on `sales.order.deleted` and reinstatement on `sales.order.confirmed` into §6.5 and §11 (C5)? | Yes, as built in the reference, with these points written into the spec:<br>• the key `reinstate:<reserveKey>`;<br>• the amount is the released amount, not the original;<br>• a refusal leaves the order live, calls `reportError` and notifies with the order link;<br>• the raw `sales_orders` status read is accepted as an FK-id read, through `isCancelledOrderStatus` rather than literal strings. | Without it, undoing a cancellation or a delete leaves a live order with no credit held (#8404, #8406). Refusing the undo instead would need a `sales` seam. |
| O2 | Ship the five unbuilt credit events and the reserve/release/settle audit-log entries, or drop them (C6)? | Drop the audit-log sentence: the ledger's actor columns and `idempotency_key` are the audit trail. Ship `credit.reserved`, `credit.released` and `credit.settled`, which are cheap and useful to webhooks. Defer the two `credit_account.*` events, or emit them from the account PUT. | Every id that ships freezes. An id declared now and never emitted misleads subscribers. |
| O3 | Exposure floor: may `adjust`, `settle` and undo drive exposure below zero? This was open at closure and raised in R1–R6. | Allow it, and state it in §5.5. `available > credit_limit` then means prepaid credit. Add a UI warning. | Allowing it lets an operator mistake raise available credit above the limit (QA saw this). Forbidding it needs a refund path. |
| O4 | UI scope for Release 5. The reference has none of: the terms-form fields and both warnings (#8663, Medium for configuration UX); the staff approvals list and decide dialog; the credit "no account" banner; pre-filling the account form. §7.3, §13 UI paths and US-C1, US-E2 and US-F1 require all of them. | Ship the terms-form fields and warnings in Release 5, because without them a UI-only operator cannot make a threshold apply (#8663). Defer the staff approvals page and the banner to a follow-up, and mark them deferred in §7.3, §13 and §17. | Deferring the approvals page leaves merchant deciders with API access only, and the in-app notification has no link target. |
| O5 | Money precision: is credit always 2 dp, whatever the currency's `decimalPlaces`? | Yes for Release 5: state "2 dp; currencies with other minor units are unsupported for on-account" and refuse such accounts at create. | A 0-dp currency (JPY) or a 3-dp currency (BHD) would otherwise round silently. |
| O6 | Should credit limit and hold changes be an audited, undoable command? The reference uses plain CRUD with no audit (`credit-accounts/crud.ts:240-289`). | Yes: `customer_groups.credit_account.update`, a command with an audit entry. Changing a limit is a financial authority change (§9.1 separates `credit.manage` for this reason). | Adds one command and its undo. |

## 📋 Readiness gate

| # | Item | Result | Evidence / fix |
|---|---|---|---|
| R1 | Declared status | ✅ | `Specification`. The repo defines no "ready" status; Phases 1–2 shipped from the same status. Suggest adding "Phases 3–4 approved for implementation (Release 5)" once this audit's fixes land. |
| R2 | No blocking open questions | ✅ | §15 items 1–4 are all deferred or assumed. The decisions doc (D-R5-1…37) records "Still open: none". No `⚠ NEEDS HUMAN CONFIRMATION` entry. New owner questions O1–O6 come from this audit. |
| R3 | Traceability | ❌ | C6: the five §10 credit events and the §6.5 audit-log entries have no oracle in §13 and no implementation. Also untested: schedule registration on existing tenants, and the approval e-mail delivery ledger (see Gaps). |
| R4 | Contracts defined | ❌ | C3: the frozen approval payload has no audience. Also: the `approval_not_pending` body lacks the deciders that US-F1 needs, the error-body shape differs from the platform's, and `GET …/approvals/:id` is undeclared (see the table in Spec vs. reference). |
| R5 | Phases deliverable | ✅ | Phase 3 has four ordered steps and a gate. Phase 4 is one block without steps; the re-landing plan's CG6–CG8 supply the split. Suggest copying that split into §14. |
| R6 | Grounded in the codebase | ❌ | C1 (money model after #7324) and C2 (transaction model vs checkout §7.2). Minor: §9 says the portal *routes* use `requireCustomerAuth` and `requireCustomerFeatures`. Those are page metadata (`shared/src/modules/registry.ts:46-48`); portal API routes check auth and features inside the handler. §6.5 says identity is read "through the query engine"; the reference uses a raw FK-id SQL read. |

## 💥 Backward compatibility

The spec's §8.4 classification holds: everything is additive. Below are only the rows that need action.

| # | Surface (BC doc) | Phase/step | Change | Severity | Migration path |
|---|---|---|---|---|---|
| B1 | 5 Event IDs (FROZEN) | P4 (CG6) | `ApprovalEventPayload` freezes without `recipientUserIds` (C3). Adding the audience later is additive, but until then the payload leaks. | Critical (via C3) | Add the field before the first emit. |
| B2 | 5 Event IDs (FROZEN) | P3 (CG2b) | §10 declares five credit ids that will not be emitted (C6) | Warning | Ship or drop them before the first release (O2) |
| B3 | 2 Types (STABLE) | P4 (CG1) | `ResolvedTerms` gains four fields. Apps that override `customerGroupsService` must return them. §8.4 promises an `UPGRADE_NOTES.md` entry; the reference has none. `ResolvedTermsSources` now also carries the value `'base_currency'`, which is not a group id; explain-terms and any reader that resolves `sources` values as group ids must handle it. | Warning | Write the UPGRADE note, and name the sentinel in §6.0. |
| B4 | 2 Types / 3 Signatures | P4 (CG1) | `ResolveTermsInput` gains an optional `organizationId`, without which D-R5-37 never applies (`customerGroupsService.ts:120-131,463` at the reference). The spec's `BuyerIdentityInput` omits it. | Warning (additive, undocumented) | Add `organizationId?` to §6 and require every Release 5 caller to pass it. |
| B5 | 9 DI Service Names (STABLE) | P4 (CG6) | The reference registers an extra key, `customerPurchaseApprovalServiceFactory` (`di.ts:66-73`), which the spec does not name. It becomes a contract on ship. | Warning | Declare it in §6 and §8.4, and add the credit-service equivalent (see C2). |
| B6 | 8 Database Schema (ADDITIVE-ONLY) | P3, P4 | New tables, but no encryption-map backfill (C4) | Critical (via C4) | `buildEncryptionMapBackfillSql` migrations |
| B7 | 8 Database Schema | P4 (CG8) | Undeclared columns `requested_email_sent_at` and `decided_email_sent_at`, and an undeclared table `customer_purchase_approval_email_deliveries`. `Migration20261112192508` has no `down()`. | Warning | Specify the delivery ledger in §5 and drop the two vestigial columns when porting. |
| B8 | 1 Auto-discovery / 14 Generated | P3, P4 | New `encryption.ts`, `notifications.ts`, `subscribers/`, `workers/` | — additive | `yarn generate` |
| B9 | 7 API routes, 10 ACL, 11 Notification ids, 13 CLI | P3, P4 | Additive as in §8.4. One undeclared route (`GET …/approvals/:id`). | — | Declare it in §9. |

The migration section (§8.4) exists. It is incomplete:
- It is missing the encryption backfill (C4).
- It is missing the schedule upgrade action `customer_groups.register-schedules` (#8822; `configs/lib/upgrade-actions.ts:287-300` at the reference).
- The second ACL sync command is redundant. Since #5900 (`UPGRADE_NOTES.md:3549`), `auth sync-role-acls` also syncs portal roles. It is harmless to keep.

## 📝 Spec completeness

| Section | Missing / incomplete | Impact | What to add |
|---|---|---|---|
| §5.4–§5.6 money | `numeric(16,2)` and the "minor-unit helpers" are stale (C1) | The port copies `numeric(16,2)` and its own BigInt helpers (`customerCreditService.ts:232-301`), and the account limit goes through float `z.coerce.number().toFixed(2)` (`validators.ts:288,307-314,350`; `crud.ts:148,280`) | (1) Make the new money columns `numeric` with `ExactDecimalType`. (2) Do the math with `@open-mercato/shared/lib/decimal`. (3) State the rounding rule as 2 dp half-up at the service boundary, applied to the stored value. (4) Have validators accept decimal strings. |
| §5 data model | Approval e-mail delivery ledger | Exactly-once-per-recipient e-mail has no specified storage | `CustomerPurchaseApprovalEmailDelivery` (unique `(tenant_id, approval_id, kind, recipient_key)`), written after `sendEmail` resolves |
| §6 service contract | Missing methods and keys used by real callers | The port has to invent public surface | Add `getAccountExposure`, `getAccountExposures` (batched), `adjustCredit`, the factory keys, `ApprovalWithdrawActor`. State the behaviour of `linkCreditReservationToOrder` for an unknown key and of a settle whose `reserveIdempotencyKey` names no reservation. |
| §8.4 / §11 schedules | Registration on existing tenants | The expiry and audit jobs never run there (#8822) | The upgrade action, plus `seedDefaults` for new tenants |
| §9.2 errors | `invalid_buyer`, `invalid_amount`, `no_account` raised from settle and adjust; the 422 mapping; the body shape | Clients cannot rely on the catalogue | Add the codes. State the platform shape `{ error: <translated message>, code }`. Add the deciders to the `approval_not_pending` body. |
| §10.2 e-mail | Dependency on `PLATFORM_PORTAL_BASE_URL` | `urlForCustomerOrg` throws in production without it, so the e-mails are never delivered (#8424) | State the requirement and document it in `UPGRADE_NOTES.md` and `.env.example` |
| §14 Phase 4 | No step breakdown | Cannot be reviewed as small PRs | Copy CG6 (core), CG7 (routes), CG8 (notifications) |
| Config keys | `customer_groups.approval_expiry_days`, `customer_groups.approval_emails_enabled` | Undocumented operator settings | Add them to the user docs (`apps/docs`) |

## 🔍 Repo-rule compliance

| Rule (source) | Spec location | Fix | Severity |
|---|---|---|---|
| GDPR fields need a backfill migration (`packages/core/AGENTS.md` → Encryption) | §8.4, §16 | C4 | Critical |
| Cross-company isolation of portal broadcasts (root `AGENTS.md` → Never expose cross-tenant data; Sec-Medium #10) | §10.1 | C3 | Critical |
| Money uses `@open-mercato/shared/lib/decimal` and `ExactDecimalType` (`BACKWARD_COMPATIBILITY.md` → Arbitrary-Precision Money, 2026-10-08) | §5.3–§5.6 | C1 | Critical (R6) |
| Service calls must run on the caller's `EntityManager` (C2) (`packages/core/AGENTS.md` → `withAtomicFlush`; #8414; Sec-Medium #11, where a second connection under a held lock exhausted the pool) | §6.3, §6.5 | (1) Rewrite §6.3: in Release 5 `reserveCredit` runs as its own transaction (checkout §7.2, step 4). (2) Keep the nested-transaction test as a guard. (3) Drop the "joins checkout's transaction" rationale, and drop the "stock then credit" deadlock rule, which is moot without a shared transaction. (4) Add `customerCreditServiceFactory(em)` like the approval factory. (5) Require the identity reads (`lib/creditIdentity.ts:42-113`, `getConnection().execute`) to go through the caller's `em.execute`. | Important |
| Side effects fire only after commit (`packages/core/AGENTS.md` → `withAtomicFlush`) | §10.1 "emitted after the writing transaction commits" | When the factory path joins an outer transaction (cart commands), emission happens before the outer commit. State that callers on a joined transaction emit after their own commit, or return the events to the caller. | Important |
| Domain writes through commands with audit and undo (`packages/core/AGENTS.md` → Always) | §9, credit-account PUT | O6 | Important |
| Error reporting: a catch that records an error calls `reportError` (root `AGENTS.md` → logging row) | §11 subscribers and jobs | Applies when porting: `subscribers/credit-limit-exceeded-notification.ts:72-74`, `workers/credit-exposure-audit.ts:186-193`, `lib/scheduling.ts:79-83,102-106` only log | Important |
| `pageSize ≤ 100`, uuid-validated `ids` filters (root `AGENTS.md` → UI & HTTP; `core` → API Interceptors) | §9 approvals list | The reference accepts invalid `ids` and answers 500 (`validators.ts:468`). Validate them as uuids. | Nice-to-have |

## ⚠️ Risks

| Risk | Level | Impact | Mitigation |
|---|---|---|---|
| Plaintext notes on existing tenants (C4) | High | Hold reasons and decision notes about people stored unencrypted | Backfill migrations with an encryption-enabled test that asserts ciphertext at rest |
| Cross-company SSE leak (C3) | High | One company sees another's purchase approvals and amounts | `recipientUserIds` plus a two-company SSE isolation test |
| Credit service on a second connection, or outside the caller's transaction (C2, #8414) | High | Pool exhaustion under parallel submits; events for rolled-back work | Factory keys and `em.execute`; PG test with pool size = concurrency |
| Order lifecycle desync (C5, #8819 open) | Medium | Undo or revival leaves a live order with no credit held | O1, plus a refusal notification that names the order |
| E-mails never delivered (#8424) | Medium | Buyer deciders never learn about requests | Document `PLATFORM_PORTAL_BASE_URL` |
| Jobs missing on existing tenants (#8822) | Medium | Approvals never expire; exposure drift is never audited | Upgrade action in §8.4 |
| Exposure never decreases without an integration (spec R9) | Medium | `limit_exceeded` for paying customers | Already mitigated in the spec (user docs, `/adjust`) |
| `sumExposure` loads every ledger row under the lock (`customerCreditService.ts:442-451`) | Medium | Locked writes slow down as the ledger grows | Port with SQL `SUM` through `em.execute` (the batch path at `:500` already does this) |
| Recipients capped at 100 and checked one RBAC call each (`approvalPortalAudience.ts:7,62-65`, #8461) | Low | A large company misses e-mails or SSE; N+1 at request time | Batch the RBAC check; state the cap in §10.2 |
| Decide/expiry boundary uses the app clock (`svc:552`, `expireApprovals.ts:41`) | Low | Skew between hosts blurs the boundary instant | Use DB `now()` in the conditional updates |

## 🔍 Gaps

- **Critical** — C5, C6 above.
- **Important** — **cross-spec call shapes.**
  - Cart §9a step 4 calls `requestApproval({ scope, customerId, … })`, but this spec's contract is `buyer: { customerIds }`.
  - Checkout §7.2 step 4 calls `reserveCredit({ scope, customerId, currencyCode, amount, idempotencyKey })`. It passes neither `sourceType` nor `sourceId`, both of which are required here.
  - Fix the consumer specs, or widen this contract, in the same revision pass.
- **Important** — **identity edge.** With a single person id, `resolveCompanyFirstCustomerId` returns the person (`creditIdentity.ts:39`). An approval then carries a person `customer_id` that portal visibility never matches. §6.5 should say what happens for a person with no company: refuse the approval with `invalid_buyer`, or allow it as requester-only.
- **Important** — **`expires_at` passed but not yet processed.** §9.2 says the request reports `status: 'expired'`. The reference reports `pending` in the 409 body and in every read (`svc:579,608-611`). Pick one, and make reads derive `expired` when `expires_at <= now()`.
- **Important** — **withdraw by a non-requester.** §13 expects `403 approval_withdraw_forbidden`. A buyer without the decide feature gets `404`, because the visibility check runs first (`api/portal/approvals/[id]/withdraw/route.ts:48-49`). Reword §13 to: `404` for non-visible requests, `403` for visible non-requesters.
- **Important** — **`requestApproval` unique-violation recovery inside an outer transaction.** An aborted Postgres transaction cannot re-read (`svc:439-452`). §6.6 should require a savepoint or `INSERT … ON CONFLICT DO NOTHING`.
- **Important** — **amount sign.** §5.5 says "never zero, reserve positive". The reference accepts amounts ≤ 0 on reserve and settle (`customerCreditService.ts:564-566,838-841`). Add `invalid_amount` for these to §9.2.
- **Important** — **`termsCurrencyCode` validation.** The column accepts any string of up to 4 characters (`validators.ts:217,246`), so `eur` sends every cart to approval. §5.3 should require ISO 4217 uppercase, as the credit-account currency already does (`/^[A-Z]{3}$/`).
- **Nice-to-have**:
  - The §9.1 snippet omits the shipped `dependsOn` and `module` fields (`acl.ts` on `main`).
  - The audit job runs per organization, not per tenant (`lib/scheduling.ts:59-83`).
  - The audit's "run now" `ProgressJob` trigger and its list of drifting accounts are not built.
  - Turning a hold off keeps the old `hold_reason` stored (`crud.ts:251-254`).

## 📋 Remediation plan

1. **Before implementation:**
   - Spec edits for C1–C4 and C6.
   - Owner answers O1–O6.
   - Align the cart §9a and checkout §7.2 call shapes.
   - Add to the spec: the delivery ledger, the factory keys, the extra service methods, `organizationId` on `ResolveTermsInput`, `GET …/approvals/:id`, `cart_converted_as_quote`, `recipientUserIds`, and the error catalogue additions.
   - Add the schedule upgrade action and the encryption backfills to §8.4.
   - Add a changelog line.
2. **During implementation (add to each step's plan):** the "reference must change" rows below. The most important are #8820 (`instanceof`), the positive-amount guards, `em.execute` for identity reads, the backfills, the UPGRADE notes and the `reportError` calls.
3. **After implementation (follow-up):**
   - Batch RBAC for recipients (#8461).
   - The staff approvals page and the credit banner, if O4 defers them.
   - Per-approver limits (§15.4).

## Spec vs. reference implementation

Classification: (a) spec should change · (b) reference must change when ported · (c) owner decision. Reference paths are relative to `packages/core/src/modules/customer_groups/` at `bdb747c36a`.

### Credit (Phase 3)

| # | Spec § | Reference | Disagreement | Class |
|---|---|---|---|---|
| 1 | §5.3–§5.5 | `Migration20261026144220_customer_groups.ts` (`credit_limit`, `amount`, `balance_after` are `numeric(16,2)`); `services/customerCreditService.ts:232-301` | Both follow the pre-#7324 money model (C1) | (a) + (b) |
| 2 | §6 interface | `customerCreditService.ts:177-222` | Exports `getAccountExposure`, `getAccountExposures` and `adjustCredit` (not in the spec). `ReserveCreditInput.sourceType` accepts every ledger source (`:104`). `linkCreditReservationToOrder` answers `{linked:false, entryId:null}` for an unknown key (`:136,1089`). | (a) declare the methods and the not-found result; (b) narrow `sourceType` |
| 3 | §6 `CreditCheck` | `customerCreditService.ts:641-645` | A replay of a released key returns `allowed:false, reason:'ok'` | (b) |
| 4 | §6.3 | `customerCreditService.ts:585-698,774,847,965,1070` | The row lock matches the spec (`PESSIMISTIC_WRITE` inside `withAtomicFlush({transaction:true})`). Release reads the reserve entry before it locks (`:778`), so it cannot lock "first". | (a) wording |
| 5 | §6.3 "SUM(amount)" | `customerCreditService.ts:442-451` | Sums in memory over every row | (b) |
| 6 | §6.3 / §6.5 identity | `lib/creditIdentity.ts:30-56,42-113` | Raw `getConnection().execute`: second connection, no organization filter, not "the query engine" | (a) wording; (b) `em.execute` + organization filter |
| 7 | §6.3 / §6 (G26) | `customerCreditService.ts:1123-1125`, `di.ts` | Builds its own `CustomerGroupsService` without `baseCurrencyService`, so it ignores a DI override of `customerGroupsService` and never applies D-R5-37 | (b) resolve the DI key |
| 8 | §5.5 sign rule | `customerCreditService.ts:564-566,838-841` | No positive-amount guard on reserve or settle | (b) |
| 9 | §6.5 rule 5 | `customerCreditService.ts:881-896` | An unknown `reserveIdempotencyKey` silently becomes an account-level settle | (a) state it, or (b) refuse |
| 10 | §5.5 / §6.5 adjust key | `commands/adjustCredit.ts:106` | `adjust:client:<key>` or `adjust:auto:<uuid>`, not "the command id"; the client may send `idempotencyKey` | (a) |
| 11 | §5.5 `linked_order_id` | `customerCreditService.ts:1111`; migration | ORM write under the account lock, not the conditional `UPDATE`; index not partial; no self-FK on `related_entry_id` | (a), either form is safe |
| 12 | §9.2 | `customerCreditService.ts:75-80`; `api/…/[id]/adjust/route.ts:156,161`; `credit-accounts/crud.ts:81-87` | Extra codes `invalid_buyer`, `invalid_amount`, `no_account` (settle and adjust). Body is `{error: message, code}`. 409 or 422 mapping. `instanceof` is still in place (#8820, open; it answers 500 in a production build). | (a) catalogue and shape; (b) duck-typed guard |
| 13 | §9 routes | `credit-accounts/route.ts:10-18`, `crud.ts:39-52,240-289` | No `[id]` segment (`?id=`, id in the body: the module convention). The list returns snake_case `updated_at`. PUT answers `{ok:true}`. | (a) |
| 14 | §9 `…/credit-accounts/missing`, D-R5-5 | — | Not built | (b), or (c) via O4 |
| 15 | §9 credit-account PUT | `crud.ts:240-289` | Plain CRUD with no audit or undo, and no hold events | (c) O6 |
| 16 | §10 / §10.1 | `events.ts:16-26`; `customerCreditService.ts:306-365,752-764,1059` | Only `credit.limit_exceeded` and `credit.adjusted` are declared. Their payloads match §10.1. Emitted before the outer commit when joined. | (c) O2; (a) emission wording |
| 17 | §6.5 audit-log | — | No audit entries for reserve, release, settle or link | (c) O2 |
| 18 | §16 / §8.4 | `encryption.ts:11-30`; no backfill | #8893 | (a) + (b), C4 |
| 19 | §6.5 / §11 lifecycle | `subscribers/order-deleted-credit-release.ts`, `order-confirmed-credit-reinstate.ts:100-216`, `order-cancelled-credit-release.ts:97-144` | Adds delete-release and confirm-reinstate. Per-order advisory lock. Raw `sales_orders` read with hard-coded `'canceled'`/`'cancelled'`. A refused reinstatement only calls `reportError`. | (c) O1; (b) use `isCancelledOrderStatus` |
| 20 | §10.2 limit notification | `lib/creditNotifications.ts:41-86`; `workers/credit-exposure-audit.ts` | Links to the order when `sourceType: 'order'`. The audit worker also notifies for drifting accounts over their limit. | (a) document both |
| 21 | §11 audit job | `lib/scheduling.ts:59-83`, `configs/lib/upgrade-actions.ts:287-298`, `workers/credit-exposure-audit.ts:75-87,162,186-193` | Per organization; daily cron `0 3 * * *`. Upgrade action present. No ProgressJob trigger. Result holds counts only. Latest entry picked by app clock. One catch block has no `reportError`. | (a) scope and action; (b) the rest |
| 22 | §6.5 / §16 adjust | `commands/adjustCredit.ts:118-161`; `adjust/route.ts:90-145` | Undo semantics match. No exposure floor. The ledger write uses the request `em`, not the command's transactional `em`, so the entry and the audit log are not atomic. | (c) O3; (b) atomicity |
| 23 | §7.3 / §17 Epic E | `widgets/injection/credit-panel.tsx:338-339,416-424,592-602,619-664,679-686` | Missing: banner, pre-fill, person→company link (it creates person-level accounts that company-first resolution never uses), settlement disclaimer, explicit `available < 0`, linked order on release entries. Adjust sends no `idempotencyKey`. | (b), or (c) via O4 |
| 24 | §8.4 | `UPGRADE_NOTES.md` at the reference (only G26 at ~1908-1930) | No `ResolvedTerms` override note, threshold behaviour note, ACL sync step, schedule action or `PLATFORM_PORTAL_BASE_URL` | (b) |

### Approvals and terms (Phase 4)

| # | Spec § | Reference | Disagreement | Class |
|---|---|---|---|---|
| 25 | §6 `ApprovalActor` | `services/customerPurchaseApprovalService.ts:540-549` | The service re-derives the decider's company from `customer_users` and ignores `customerEntityId` (stronger than the spec) | (a) |
| 26 | §6 | `customerPurchaseApprovalService.ts:54-56`, `di.ts:66-73` | Extra: `customerPurchaseApprovalServiceFactory(em)`, `ApprovalWithdrawActor`, `isCustomerPurchaseApprovalServiceError` | (a) |
| 27 | §6 `expectedUpdatedAt` / §5.6 | `customerPurchaseApprovalService.ts:162-172`; decide routes `:60-65`/`:65-70` | The field is ignored. The routes call `enforceCommandOptimisticLock` themselves. Portal withdraw has no header check. | (a) drop the field |
| 28 | §10.1 | `customerPurchaseApprovalService.ts:336-369`, `lib/approvalPortalAudience.ts:7,42-72`, `lib/expireApprovals.ts:67-87` | `recipientUserIds`: the requester plus portal deciders, capped at 100, with a sentinel uuid when empty (C3) | (a) add the field; (c) the cap |
| 29 | §5.6 / §6 / §10.1 enums | `data/entities.ts:36-43`, `validators.ts:438-445` | Extra withdrawn reason `cart_converted_as_quote` | (a), also in §7.4 |
| 30 | §9.2 `approval_not_pending` | `lib/approvalErrors.ts:17-24`; `customerPurchaseApprovalService.ts:276-284,579,608-611` | No deciders in the body; `status: 'pending'` past `expires_at` | (b) |
| 31 | §6.6 creation race | `customerPurchaseApprovalService.ts:439-452` | The unique-violation re-read fails inside an outer transaction | (b) savepoint or `ON CONFLICT` |
| 32 | §6.5 identity for approvals | `lib/creditIdentity.ts:39` | A single person id stays a person | (b) or (a), see Gaps |
| 33 | §6 (G26) | `customerPurchaseApprovalService.ts:629-635` | Builds its own `CustomerGroupsService` and ignores the override | (b) |
| 34 | §6 / D-R5-37 | `services/customerGroupsService.ts:120-131,463,476-487`; `customerPurchaseApprovalService.ts:413` | The fallback needs `organizationId`. The approval service, the credit service and explain-terms do not pass it. | (a) B4; (b) pass it |
| 35 | §6.0 / US-C2 | `api/customer-groups/explain-terms/route.ts:31-37,165-170`; `widgets/injection/person-groups-explain-terms.tsx:26-56` | No explain rows for the four new fields; no handling of `'base_currency'` | (b) |
| 36 | §7.3 / US-C1 | `components/CustomerGroupTermsSection.tsx` (identical to `main`) | None of the four fields; no default-group or missing-currency warning (#8663) | (b), O4 |
| 37 | §5.3 `terms_currency_code` | `validators.ts:217,246` | Any string of up to 4 characters | (b) ISO uppercase |
| 38 | §7.3 / §13 / US-F1 | — | No staff approvals page; the in-app notification therefore has no link (`notifications.ts:37-41`) | (c) O4 |
| 39 | §9 staff routes | `api/customer-groups/approvals/[id]/route.ts`; `approvals/route.ts:62-73`; `validators.ts:468` | Extra `GET …/approvals/:id`. List sorted by `createdAt desc`, not pending first. `ids` not validated. | (a) declare it; (b) validate |
| 40 | §9 portal auth | `api/portal/approvals/*` (`requireAuth:false`); `lib/portalApprovalAuth.ts:37-62` | In-handler customer auth and feature checks (the platform pattern for API routes). Mutation guards get `userFeatures: []`. | (a) wording |
| 41 | §13 withdraw | `api/portal/approvals/[id]/withdraw/route.ts:48-49` | A non-decider sees 404, not 403 | (a) |
| 42 | §5 e-mail storage | `data/entities.ts:602-657`; `Migration20261026213913`, `Migration20261112192508` (no `down()`) | Delivery ledger table and two vestigial timestamp columns | (a) specify the ledger; (b) drop the columns, add `down()` |
| 43 | §10.2 | `lib/approvalEmails.ts:49-67,190-194,204,306`; `customer_accounts/lib/customerUrl.ts:23-33` | Recipients and the switch match. The link goes to the portal root. No re-check that the request is still pending. Throws without `PLATFORM_PORTAL_BASE_URL` (#8424). N+1 RBAC (#8461). | (a) document; (b) re-check and batch |
| 44 | §11 expiry | `lib/scheduling.ts:85-101`; `lib/expireApprovals.ts:41` | Hourly, tenant scope, batches of 200: matches. The app clock is used for the boundary. Withdraw has no `expires_at` guard (`customerPurchaseApprovalService.ts:506-510`). | (b) |
| 45 | §8.4 | reference `UPGRADE_NOTES.md` | See row 24. The second sync command is redundant since #5900. | (a) + (b) |

## Release 5 findings G1–G26: resolution in the revised spec

| G | Finding (short) | Revised spec | Note |
|---|---|---|---|
| G1 | Concurrency strategy | ✅ resolved | §6.3 row lock; the reference matches. The "joins checkout's transaction" rationale is wrong (C2). |
| G2 | Scope on every credit call; addressable release | ✅ resolved | §6 `scope`, §5.5 `(tenant_id, idempotency_key)`, `releaseCredit` signature |
| G3 | Approval service contract | ✅ resolved | §6; add the factory key (B5) |
| G4 | Approver model | ✅ resolved | §5.6 approver model, D-R5-1 |
| G5 | Buyer-facing API | ✅ resolved | §9 portal routes; mechanism wording (row 40) |
| G6 | Race-safe transitions | ✅ resolved | §6.6 conditional updates; the reference lacks the deciders in the body and the expired status (row 30) |
| G7 | Settlement and release triggers | ◐ partly | D-R5-2 covers cancel and manual settlement. Delete and undo are not covered (C5). |
| G8 | One canonical subject | ✅ resolved | `subject_type: cart \| quote`, partial unique index; add `cart_converted_as_quote` (row 29) |
| G9 | Event-driven resume | ✅ resolved | §10.1; the cart and checkout specs own the subscribers |
| G10 | Threshold currency | ✅ resolved | D-R5-4 and D-R5-37; `organizationId` input missing (B4) |
| G11 | Identity resolution | ✅ resolved | §6.5; the reference has the person-only edge (row 32) |
| G12 | Idempotency semantics | ✅ resolved | §6.5 rules 1–6; adjust key wording (row 10) |
| G13 | Account provisioning | ✅ resolved | D-R5-5; the banner is not built (row 14) |
| G14 | Money as decimal strings | ◐ partly | Intent resolved; superseded by the #7324 decimal convention (C1) |
| G15 | Notification types and channels | ✅ resolved | §10.2; `PLATFORM_PORTAL_BASE_URL` missing |
| G16 | ACL and grants | ✅ resolved | §9.1 and §8.4 (second sync command redundant) |
| G17 | Stale route prefix | ✅ resolved | §9 uses `/api/customer_groups/customer-groups/`; the `:id` segment differs from the module convention (row 13) |
| G18 | Event set and payloads | ◐ partly | Payloads declared. `recipientUserIds` missing (C3). Five credit events not built (C6). |
| G19 | Optimistic lock per entity | ✅ resolved | §5.4, §5.6, §16 |
| G20 | Commands and undo | ✅ resolved | §6.5 for adjust and decisions; the credit-account PUT has no audit (O6) |
| G21 | Job definitions | ◐ partly | §11 defined. Registration on existing tenants is missing (#8822, §8.4). |
| G22 | Encryption | ◐ partly | Maps declared in §16; backfill missing (C4) |
| G23 | Integration coverage | ✅ resolved | §13; withdraw 403/404 wording (row 41) |
| G24 | Decision authority rules | ✅ resolved | §5.6, §6.6, §9.2; deferral in §15.4 |
| G25 | Final-input revalidation | ✅ resolved | §6.3 last rule |
| G26 | DI interface growth | ✅ resolved | Separate DI keys. Both reference services bypass an override internally (rows 7, 33). |

Summary: 21 resolved, 5 partly resolved (G7, G14, G18, G21, G22). None is unaddressed. G6 is resolved in the spec, but the reference still falls short of it.

## 🧪 Audit limits

- **Revisions read:** `main` at `5d93cbd8bf` (worktree `feat/r5-spec-revision`) and the reference at `refs/remotes/pr/8268` (`bdb747c36a`), read with `rtk proxy git show` and `git diff b7b5309ccc`. Two read-only subagents compared the credit and approval slices file by file. Their findings were spot-checked against the code:
  - the portal SSE audience;
  - `withAtomicFlush` joining;
  - the #7324 money columns;
  - the promotions decimal imports;
  - the `sales.order.deleted` emission;
  - `#5900`;
  - page-only `requireCustomerAuth`.
- **Spec template:** no template exists in `.ai/specs/`. The one filename matching "template" is a feature spec, so the built-in section set was used, plus `.ai/specs/AGENTS.md`.
- **Inputs used:**
  - review and QA history: `scratchpad/analysis/review-history.md` §2.1, §2.2, §3;
  - the issue appendix: `scratchpad/parts/appendix-issues.md`;
  - the re-landing plan cards CG1–CG8: `scratchpad/parts/part-22-customer-groups.md`.
- **Not run:** builds, tests or the real-Postgres suites; no tracker calls. Line numbers at the reference come from the extracted copies in `scratchpad/audit-tmp/cg/{credit,approvals}/ref/`.
- **Absence claims** are scoped to the reference tree and `main` as searched. Examples: "not built", "no backfill", "no audit entry".
- **Suspected prompt injection:** none found.

Readiness: no-go
Report: .ai/analysis/pre-implement-2026-08-14-customer-groups-and-b2b-terms-release-5.md
Spec: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md
