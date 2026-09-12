# Pre-Implementation Analysis: Checkout Module — Unified Checkout Funnel (v2 rescope)

**Source PR**: adeptofvoltron/open-mercato#9, branch `spec/ecommerce-module-suite` (spec-only, no code)
**Target document**: `2026-03-19-checkout-simple-checkout.md`, v2 (rescoped 2026-08-14), suite spec 7 of 10, Phase 3
**Ground truth used**: `packages/checkout/src/modules/checkout/` (Phase A, implemented, in production) in this worktree
**Analyst note**: This is the fourth document in this audit series (`cart-module.md`, `customer-groups-and-b2b-terms.md`, `SPEC-055` amendment, and now this one). Unlike the fully-greenfield sibling specs, this document rescopes an **already-shipped** package, so every finding below is checked directly against the real, running Phase A source — not just against platform convention.

---

## Executive Summary

The v2 rescope is architecturally sound — ADR-1 through ADR-8 are followed, the cart/checkout boundary is correct, and the submit-sequence's compensation table (§7.3) shows real engineering judgment about a genuinely hard saga problem. However, the document is **not ready to implement**. It repeats, for the fourth time in this suite, the `version: integer` optimistic-locking mistake — and this occurrence is the most serious of the four, because it contradicts the **already-shipped code of the exact package this spec extends**, not just an abstract platform convention. It also fabricates two ACL feature IDs it labels "Phase A" that do not exist in the real Phase A `acl.ts`, omits `promotions` and `workflows` from its own cross-module integration table despite using both, and asserts two `CheckoutTransaction` columns are "retained from v1" that do not exist in the current entity. None of these are hard to fix, but all four must be fixed before implementation — the ACL and DB-schema misstatements in particular would mislead an implementer into treating fabricated/non-existent surface as already-frozen contract. **Recommendation: Needs spec updates first**, not a major revision — the architecture is right, the artifact-accuracy is not.

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Database schema / optimistic locking | §4.1 specifies `CheckoutSession.version: integer`, referenced again in §7.1, §9, and §19. Confirmed against `packages/checkout/src/modules/checkout/data/entities.ts`: none of `CheckoutLinkTemplate`, `CheckoutLink`, or `CheckoutTransaction` has a `version` column — each carries only `updatedAt`. The lock check is wired through `enforceCommandOptimisticLockWithGuards`, called with `current: link.updatedAt`/`template.updatedAt` (`commands/links.ts:292-297,444-449`, `commands/templates.ts:280-285,445-450`); `commands/__tests__/optimistic-lock.test.ts` asserts against ISO-timestamp comparison, not an integer counter. Fourth occurrence of this exact mistake in the suite — and the worst, since it contradicts working, shipped code in the very package being extended. | **Critical** | Drop `CheckoutSession.version`. Use `updated_at`/`updatedAt` (already present via "Standard scoped columns") as the sole concurrency token. Rewrite §7.1 precondition 1, §9's "Mutating routes take `version`," and §19's optimistic-locking row. Wire mutations through `enforceCommandOptimisticLock`/`enforceCommandOptimisticLockWithGuards` — the exact helper Phase A's own commands already call. The conditional `open → submitting` transition (§7.4) may keep its own CAS semantics (mirrors `checkout.transaction.updateStatus`'s pattern) as an *additional*, different guard — not a substitute for the `updatedAt` lock on editable fields. |
| 2 | ACL feature IDs (FROZEN) | §9.1 declares `checkout.links.view`/`checkout.links.manage` labeled `// Phase A`, implying reuse of existing IDs. They do not exist. Real Phase A `acl.ts` declares six flat features: `checkout.view`, `.create`, `.edit`, `.delete`, `.viewPii`, `.export` — no `checkout.links.*` namespace. Implementing as written creates two uncoordinated authorization surfaces over the same links resource. | **Critical** | Remove the fabricated IDs and the false `// Phase A` label. Reuse `checkout.view`/`.edit`/`.create`/`.delete` for link/template access; add only genuinely new `checkout.sessions.view`/`.manage` for the new session-admin surface. If a rename to `checkout.links.*` is truly intended, that's a FROZEN-ID rename requiring the full deprecation protocol, not a one-line table note. |
| 3 | Database schema — factual accuracy | §4.4 lists `CheckoutTransaction.quote_id`/`.order_id` as "From v1, retained," implying they already exist. They don't — the real entity (lines 229-316) has no such columns; consistent with the doc's own §14 admission that v1 "was never implemented." Not a BC violation (still a safe additive migration), but risks an implementer skipping the migration under a false belief. | Warning | Reword to "New, additive — proposed in v1 but never implemented past Phase A," matching the honest framing already used for `CheckoutCartItem` in §14. |
| 4 | Event IDs — naming-pattern ambiguity | §10 introduces `checkout.payment.initiated`/`.succeeded`/`.failed`. Phase A already has `checkout.transaction.sessionStarted`/`.completed`/`.failed` covering the same payment-lifecycle domain, and session-based `CheckoutTransaction` rows still write to the same table. No literal ID collision, but the spec never states whether both event families fire for the same transaction. | Warning | Add one sentence stating whether a session-based checkout's `CheckoutTransaction` still emits Phase A's `checkout.transaction.*` events unchanged alongside the new `checkout.payment.*` ones, or instead of them. |

### Missing BC Section

No "Migration & Backward Compatibility" section exists. §14 and §19's BC row cover `CheckoutCartItem` retirement only; none of findings 1–4 above are addressed anywhere centrally.

---

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Migration & Backward Compatibility | Findings 1–4 have no canonical home | Add, consolidating all four |
| UI/UX | Step machine is UI-heavy with zero wireframe/component reference | Low-medium — per the roadmap, storefront UI is spec 10's scope; add one line stating this explicitly so the omission reads as intentional. The admin session viewer (§17 Phase B.6) does need standard backend-UI treatment and isn't otherwise called out. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §7.2 Sequence | Step 4 claims `sales.quotes.create` + `sales.quotes.convert_to_order` execute "in one DB transaction," but each `commandBus.execute()` call in this codebase owns and commits its own transaction — no mechanism stated for sharing one across two command calls | State the actual mechanism (shared EM via `ctx`, or drop the literal "one transaction" claim and rely on the compensation table) — central to R1's mitigation story |
| §11 Commands | States session transitions are "not commands," without acknowledging Phase A's own `checkout.transaction.create`/`.updateStatus` are equally irreversible/financial yet **are** command-routed (`commands/transactions.ts:279-280`) | See AGENTS.md Compliance below |
| §4.1 / §13 / §19 Encryption | Claims encryption without naming the mechanism | See AGENTS.md Compliance below |

---

## AGENTS.md Compliance

### Violations / Gaps

| Rule | Location | Fix |
|------|----------|-----|
| Commands — "session transitions are NOT commands" framed as a blanket exemption | §7.2, §11 | The non-undoable framing is correct and should stay. But Phase A's own precedent (`checkout.transaction.create`/`.updateStatus`, command-routed despite no meaningful undo) shows non-undoable and command-routed are not mutually exclusive here. Fix: route each session state transition through a registered command (`checkout.session.lock`, `.reserveStock`, `.reserveCredit`, `.createDocument`, `.initiatePayment`, `.complete`, `.fail`), each with a minimal/no-op undo, mirroring `checkout.transaction.updateStatus`. Keep the non-undoable framing — only "therefore not a command" needs to go. |
| Transactional safety of the submit sequence | §7.2, §7.3 | Two things true simultaneously: (1) the overall 8-step sequence correctly should NOT be one giant transaction — Phase A's own submit-adjacent code keeps the real gateway network call outside any open DB transaction (zero `withAtomicFlush` hits in `packages/checkout`), so the saga/compensation design is the right choice, not a shortcut needing `withAtomicFlush`-style wrapping (unlike `cart-module.md`'s case, where the "external calls" are in-process DI services, not third-party network calls). (2) What's missing is atomicity discipline for each individual step's own `CheckoutSession` field mutation — state explicitly that each step's write uses the same per-step CAS discipline Phase A's `updateStatus` command already demonstrates, scoped to that step only. |
| Compensation-failure handling — kept, not weakened | §7.3, R9 | §7.3's "never swallowed" guarantee is stronger than Phase A's current practice (which does swallow compensating-write failures via `.catch(() => undefined)`). This should stay as specified — flagged as a note for implementers, not a defect. |
| Cross-module integration table completeness | §3.3 | `promotions` and `workflows` are both used but absent — see Gap Analysis |
| Missing module `requires` declaration | §19 | Sibling specs now explicitly state their `requires` array (`cart-module.md` §A.2b, `customer-groups-and-b2b-terms.md` §7.3). Add one for `checkout`, distinguishing hard deps (`cart`, `sales`, `promotions`) from soft/optional ones. |
| Encryption — half-verified | §4.1, §13, §19 | Unlike two earlier fully-unbacked occurrences in this series, the mechanism already exists here: `packages/checkout/src/modules/checkout/encryption.ts` exports `defaultEncryptionMaps` covering `checkout:checkout_link_template`, `checkout:checkout_link`, `checkout:checkout_transaction` (confirmed, with a dedicated `__tests__/encryption.test.ts`). Name the exact addition: `{ entityId: 'checkout:checkout_session', fields: [{ field: 'email' }, { field: 'phone' }, { field: 'shipping_address' }, { field: 'billing_address' }] }`. Classified Warning, not Critical, since the infra already exists. |
| DI service naming | §3.3, §19 | Phase A's `di.ts` is currently a no-op stub (pure DI consumer, registers nothing). §3.3 implies checkout will newly resolve `cartService`/`availabilityService`/`customerGroupsService`/`promotionsService` — consistent with the existing consumer-only pattern, but §19 should state this plainly since `di.ts` will need to move off the no-op stub for the first time if it needs to register anything for the new session-admin surface. |

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Fabricated ACL IDs ship as if already Phase A | Two uncoordinated authorization surfaces over the same links resource — a real security-relevant divergence | Fix per BC finding #2 before implementation; cross-check every "Phase A" claim against the real `acl.ts`/`events.ts`/routes rather than trusting the v1 document's memory |
| "One DB transaction" claim for two sequential command calls unverified | Core mitigation for R1 ("payment without an order") — if aspirational rather than mechanical, a `sales.quotes.create` success + `.convert_to_order` failure leaves an orphaned quote with no compensation entry | Specify the mechanism before Phase B.4; add a compensation row for the split-failure case if needed |
| Per-step atomicity of `CheckoutSession` field writes unstated | A crash between two field writes in one step leaves an inconsistent state `recover-stuck-submits` may not correctly classify | State the per-step write discipline; add a crash-mid-field-write test case |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `checkout.payment.*` vs `checkout.transaction.*` event relationship unstated | A subscriber against one family silently misses or double-processes events | Clarify per BC finding #4 |
| Missing `promotions`/`workflows` rows in §3.3 | Undercounts real cross-module dependencies for anyone scoping `requires` | See Gap Analysis |
| `CheckoutTransaction.quote_id`/`.order_id` mischaracterized as "retained" | Real process risk — implementer skips the migration believing columns already exist | Reword per BC finding #3 |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| No explicit `requires` array | Inferable from §3.3 but inconsistent with sibling-spec pattern | Add explicit statement |
| No UI/UX section | Low, given spec 10's deliberate ownership | Add one-line disclaimer |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- `CheckoutSession.version` → `updatedAt`: must be fixed before Phase B.1; every downstream phase inherits the wrong mechanism otherwise.
- Fabricated `checkout.links.view`/`.manage` ACL IDs: must be reconciled before Phase B.1's ACL wiring.

### Important Gaps (Should Address)

- §3.3 omits `promotions` (step 7 calls `promotionsService.registerUsage`; confirmed zero references to `promotions` anywhere in current Phase A code — genuinely new dependency, not an oversight of an existing one) — add a row, state hard vs. soft.
- §3.3 omits `workflows` (§5.1 states it's used for the B2B approval sub-flow and post-submit orchestration; §8.2 parks the session in `awaiting_approval` pending a workflow decision) — add a row.
- No stated owner for `revertUsage` when a completed order is later cancelled by an admin (decoupled from checkout via an event the document doesn't declare) — not blocking, worth a one-line note.
- Two-command transaction sharing (§7.2 step 4): mechanism unstated.
- Per-step atomicity for `CheckoutSession` writes: unstated.
- `encryption.ts` extension not named explicitly.

### Nice-to-Have Gaps

- Explicit "Migration & Backward Compatibility" section.
- One-line UI/UX disclaimer.
- Explicit `requires` statement in §19.

---

## Remediation Plan

### Before Implementation (Must Do)
1. Drop `CheckoutSession.version`; make `updatedAt` the sole concurrency token across §4.1/§7.1/§9/§19; wire through `enforceCommandOptimisticLock`/`enforceCommandOptimisticLockWithGuards`.
2. Reconcile §9.1's ACL table against the real Phase A `acl.ts` — remove fabricated IDs, reuse real ones, add only genuinely new session-admin features.
3. Add `promotions` and `workflows` rows to §3.3, stating hard vs. soft dependency direction.

### During Implementation (Add to Spec)
1. State the exact transaction-sharing mechanism for §7.2 step 4, or drop the "one DB transaction" claim.
2. State per-step atomicity discipline for `CheckoutSession` field writes.
3. Route session state transitions through registered, non-undoable commands.
4. Name the `checkout/encryption.ts` array entry to add.
5. Reword §4.4's `quote_id`/`order_id` notes from "retained" to "new, additive."
6. Clarify the `checkout.payment.*` vs `checkout.transaction.*` event relationship.

### Post-Implementation (Follow Up)
1. Add a consolidated Migration & Backward Compatibility section.
2. Consider a follow-up ticket (out of scope here) to stop swallowing compensating-write failures in Phase A's existing code, for consistency with v2's stronger R9 guarantee.
3. State the module's `requires` array explicitly once the `promotions`/`workflows` dependency direction is settled.

## Recommendation

**Needs spec updates first.** The architecture is sound and doesn't need a major revision. Two Critical findings (the `version` mistake and the fabricated ACL IDs) and several Warning/Gap findings are concrete, evidence-backed inaccuracies against the real, shipped Phase A code this spec extends — not stylistic nits — and must be corrected before Phase B.1 begins, since every later phase inherits the optimistic-locking and ACL foundations laid there.

---

## Changelog

### 2026-08-17
- Initial pre-implementation analysis, performed against fork PR #9 (`adeptofvoltron/open-mercato`, branch `spec/ecommerce-module-suite`) and this repo's `develop` worktree, per the `om-pre-implement-spec` skill workflow, verified directly against the already-shipped Phase A source in `packages/checkout/`.
