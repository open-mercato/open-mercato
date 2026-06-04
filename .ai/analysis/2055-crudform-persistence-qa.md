# CrudForm data-persistence QA — comprehensive report (PR #2055)

**Date:** 2026-06-04 · **Branch:** `feat/oss-optimistic-locking` · **Scope:** issue [#2333](https://github.com/open-mercato/open-mercato/issues/2333) (SQL transaction-safety umbrella) and its merged PRs (#2343, #2355/#2336, #2374/#2337, #2368/#2338, #2360/#2339, #2356/#2341, #2376/#2335, #2377/#2342, #2383, #2348).

**Goal:** confirm every CrudForm / detail-edit surface saves all values — including custom fields — find root causes, ship the fixes that belong to this PR, and leave a verified matrix + follow-up list for the rest.

---

## 1. The root-cause family

The #2333 atomic-writes effort wrapped many writes in `withAtomicFlush`/`em.transactional`, but the helper **flushed once at the end** and several commands ran a query **between** a scalar mutation and that flush. Under MikroORM v7 an interleaved read (`em.find`/`findOne`/`findWithDecryption`/`nativeUpdate`, or a helper that does one — `ensureDictionaryEntry`, `syncEntityTags`, `syncLegacyPrimaryCompanyLink`, `resolveDictionaryEntryValue`, `enforcePrimaryAddress`, `enforceBaseCurrency`, …) resets the identity-map changeset, so the pending scalar `UPDATE` is silently dropped. The write returns **200 + bumped `updated_at`**, but the column never persists. #2333 calls this **UOW-LOSS**.

A second, unrelated class surfaced: **client payload shape** (a detail form spreading bare custom-field keys into the update body where the zod schema strips them) and **missing undo handlers** (commands with only `execute()` are not undoable).

---

## 2. Fixes shipped on this branch (verified)

| # | Surface | Root cause | Fix | Evidence |
|---|---------|-----------|-----|----------|
| Framework | `withAtomicFlush` | flushed once at end vs SPEC-018 per-phase contract | flush **after each phase** (atomic — inside the same transaction) | `fe22b4c8e`; shared 1150/1150, core 5393/5393; 2 ephemeral rounds green |
| #2453 | People v2 save | `ensureDictionaryEntry`/`syncLegacyPrimaryCompanyLink` interleaved read **+** dual CrudForm render (header Save hit hidden instance) | flush scalars first / single `useIsMobile` variant | browser + `TC-CRM-2453` |
| #2453 | Companies v2 save | `syncEntityTags` interleaved read | flush scalars first | browser + `TC-CRM-2453-COMPANY` |
| audit | sales updateOrder/updateQuote/returns.undo, catalog variant, directory org-delete, auth sidebar, resources(+undo), currencies, messages updateDraft, customers addresses/personCompanyLinks/pipeline-stages (13 commands) | same interleaved-read class | restructured into clean phases, no explicit flushes (framework handles it) | `629fabd87`→`fe22b4c8e`; per-command `TC-*-2453-*` |
| shipment | Order shipment **shipping method** not saving | `updateShipmentCommand` (`em.transactional`) ran `findWithDecryption(SalesShipmentItem)` after scalar mutations | pre-resolve status + flush scalars before item reads | browser + `TC-SALES-2455-SHIPMENT-METHOD` |
| delete UX | Company/person/deal detail **delete crash** | non-409 server error (e.g. `422 COMPANY_HAS_DEPENDENTS`) propagated uncaught → Next.js Runtime Error overlay | try/catch → `surfaceRecordConflict` or flash the message | browser + `TC-CRM-company-delete-guard` |
| #10 | **Deal custom fields** not saving on edit | `useDealFormHandlers` spread bare `cf_`-stripped keys into the body; `dealUpdateSchema.parse` dropped them | wrap edit custom values under `customFields` | browser-class + `TC-CRM-CF-MULTI-EDIT-001` |
| #11 | Product multichoice custom field | **not a defect** — product edit already wraps under `customFields` | regression guard only | `TC-CAT-CF-MULTI-EDIT-001` (green) |
| #9 | Order **billing-address edit Undo** failed | `sales.document-addresses.*` commands had no `undo` → `CommandBus.undo` threw "not undoable"; plus an `em`-scope bug in the snapshot helper | added prepare/captureAfter/buildLog/undo (create/update/delete) + fixed `em` param | `TC-SALES-2055-ADDRESS-UNDO` (green) |

**Verification:** two full ephemeral integration rounds (1093 passed / 0 failed / 0 flaky each) plus per-fix browser confirmation and integration specs.

---

## 3. CrudForm / detail-edit matrix

> **Structural de-risk:** `makeCrudRoute`'s update path calls `de.updateOrmEntity()` which **flushes the scalar columns before** `de.setCustomFields()` runs (`packages/shared/src/lib/data/engine.ts:469-479`). So **`makeCrudRoute` entities are NOT exposed to scalar UOW-LOSS** — the lost-write only ever affected hand-written commands. The residual `makeCrudRoute` risk is purely the **multichoice/array custom-field** write/read path (#2376), which is a distinct code path.

| Surface | Save path | Custom fields | Status |
|---|---|---|---|
| people-v2, companies-v2, deals (scalars), addresses, pipeline-stages, catalog variants, resources, currencies, directory orgs, messages, sales order/quote/shipment | hand-written command | yes/some | **FIXED + verified** |
| Deal multichoice CF, Product multichoice CF, Order address undo | command / client | yes | **FIXED + verified** (this PR) |
| Sales **payment** edit (reference/amount/status) | `em.transactional` (`updatePaymentCommand`) | yes | **VERIFIED OK** — flushes before the read; browser-confirmed scalar **and** status edits persist. (Static audit flagged it BUGGY — **false positive**.) |
| Dictionaries entry save | command (PATCH route) | no | **VERIFIED OK** (round-7) |
| makeCrudRoute scalar columns (auth roles/users, directory tenants, sales channels, currencies, resource-types, feature toggles, catalog categories, planner rulesets, staff time-projects) | makeCrudRoute | yes | **scalar-safe by construction**; multichoice CF on edit = recommended QA (#2376 path) |
| **EAV custom records** `/backend/entities/.../records/[recordId]` | dataEngine custom-field PUT | all fields are CF | **needs browser QA** — canonical #2376 multichoice territory; highest-value unverified surface |
| Non-command routes: auth ACL, customer_accounts portal ACL, business_rules rule/set, workflows definition, integrations, communication_channels | direct PUT | mostly no | **needs browser QA** — confirm scalar + member/credential persistence |

---

## 4. `em.transactional` audit (the other atomic-write mechanism)

Every `em.transactional(` call site was reviewed for the mutate→read→commit shape (the framework per-phase fix only covers `withAtomicFlush`).

- **Fixed:** `updateShipmentCommand` (this PR).
- **Clean / already-guarded:** `makeCrudRoute` update+create (flushes scalars first), `createPaymentCommand`/`updatePaymentCommand` (reads-first + locks — **browser-confirmed OK**), `convertQuoteToOrderCommand`, `createReturnCommand`, `createShipmentCommand`, attachments upload/library, customer_accounts portal roles & admin-create & password flows, messages compose/reply/forward, planner/leave-requests, catalog productUnitConversions, and the remaining spot-checked sites — all read-first-then-mutate, new-entity inserts, `nativeUpdate`, or lock-then-flush.
- **Static-flagged, UNCONFIRMED (recommended QA):** `sales/api/quotes/send` and `sales/api/quotes/accept` — both mutate the quote status scalar and then call `resolveStatusEntryIdByValue` (a dictionary `findOne`) before the terminal flush. The shape matches the fixed shipment/people bugs, but the status is re-assigned after the read so it may self-heal; **needs a browser/integration repro** (send a quote, accept it, confirm `status`/`acceptanceToken` persist). Suggested fix if confirmed: resolve `statusEntryId` **before** mutating the quote scalars (one uninterrupted assignment block).

---

## 5. Recommended follow-up QA (owner)

Browser-test each: edit → Save → **hard reload** → confirm every field (esp. **multichoice/array** custom fields) persisted.

1. **EAV custom records** (`/backend/entities/user/[entityId]/records/[recordId]`) — multichoice/array fields. *(highest priority)*
2. **quotes/send + quotes/accept** status persistence (static-flagged above).
3. makeCrudRoute multichoice custom-field edit: catalog categories, sales channels, feature toggles, planner rulesets, directory tenants, staff time-projects, resource-types.
4. Non-command routes: auth ACL, customer_accounts portal ACL, business_rules rule/set + members, workflows definition customize/reset, integrations credentials/state, communication_channels config.

Pattern for any confirmed UOW-LOSS fix: **pre-resolve dictionary/lookup reads, or `flush()` the scalar mutations, before the interleaved read — inside the same transaction** (mirror `shipments.ts` / the `withAtomicFlush` per-phase contract).

---

## 6. How to reproduce / verify

- Boot the branch: `yarn build:packages && yarn generate && yarn build:packages`, then `next dev -p 3100` in `apps/mercato` (admin@acme.com / secret).
- A field "doesn't save" repro: edit it, Save (note 200 + success toast), **hard reload** — if the value reverts, it's UOW-LOSS (or a payload-shape bug for custom fields).
- Run the persistence specs: `OM_OPTIMISTIC_LOCK=all yarn mercato test:integration <spec>` (the `TC-*-2453-*`, `TC-SALES-2455-*`, `TC-CRM-CF-MULTI-EDIT-001`, `TC-CAT-CF-MULTI-EDIT-001`, `TC-SALES-2055-ADDRESS-UNDO`, `TC-CRM-company-delete-guard`).
