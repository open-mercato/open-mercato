# TC-LOCK-OSS-000 — Manual QA Master Plan: OSS Optimistic Locking (PR #2055)

## Test ID
TC-LOCK-OSS-000 (master plan; references executable specs TC-LOCK-OSS-001…013)

## Category
Data Integrity / Concurrency — platform-wide

## Priority
High (customer-facing concurrency UX; default-ON behavior change)

## Purpose
A single, exhaustive, **manually-executable (Playwright-drivable)** test plan that aims at
**100% coverage** of the OSS optimistic-locking surface introduced by PR #2055. It folds in:
- every wired UI page (30 `optimisticLockUpdatedAt` forms + 4 custom-header callers),
- every command-level enforcer (`enforceCommandOptimisticLock`, `enforceSalesDocumentOptimisticLock`, `enforceRecordGoneIsConflict`),
- the generic `makeCrudRoute` auto-registered reader (covers every CRUD entity),
- the unified conflict bar UX,
- **all of @alinadivante's reported QA findings** (rounds 2026-05-27, 2026-05-31, round-4/5), and
- **both of @pkarw's manual QA guides** (2026-05-31 and 2026-06-01).

Each row below is independently runnable and maps to the automated spec that already
proves the API path (so manual QA focuses on the UI behaviors specs can't click through).

---

## 1. How the feature works (tester's mental model)

- **Version token = `updated_at`.** On load, an edit form captures the record's `updatedAt`.
  On Save/Delete it sends header `x-om-ext-optimistic-lock-expected-updated-at: <iso>`
  (constant `OPTIMISTIC_LOCK_HEADER_NAME`, `packages/shared/src/lib/crud/optimistic-lock-headers.ts`).
- **Server compares.** If the stored `updated_at` no longer matches → **HTTP 409** with body
  `{ error, code: 'optimistic_lock_conflict', currentUpdatedAt, expectedUpdatedAt }`.
- **Strictly additive.** A request that does **not** send the header always passes (no 409).
  So raw API clients / older callers are unaffected.
- **Default ON** (since Phase 14). Opt out with `OM_OPTIMISTIC_LOCK=off` (or `false`/`0`/`no`/`disabled`/`none`).
- **UI surface = the conflict bar.** A persistent red **"Record changed"** bar at the top of
  `AppShell` (component `packages/ui/src/backend/conflicts/RecordConflictBanner.tsx`), with a
  **Refresh** and **Dismiss** button — **not** a transient toast. It **auto-clears on route change**.
- **Coverage tiers:**
  1. `makeCrudRoute` entities → auto-registered generic reader (no per-entity wiring needed server-side).
  2. Hand-wired readers for polymorphic/complex entities: `customers.company`, `customers.person`/`people`, `sales.order`, `workflows.definition`.
  3. Command-pattern / custom routes → explicit `enforceCommandOptimisticLock` / `enforceSalesDocumentOptimisticLock`.

### Conflict-bar i18n keys (verify localization)
| Key | en value |
|---|---|
| `ui.forms.conflict.title` | `Record changed` |
| `ui.forms.conflict.refresh` | `Refresh` |
| `ui.forms.conflict.dismiss` | `Dismiss` |
| `ui.forms.flash.recordModified` | `This record was modified by someone else. Refresh and try again.` |

---

## 2. Test environment & golden rules

**Prerequisites**
- App booted from the **PR branch** (`feat/oss-optimistic-locking`), not a published-package standalone app.
  Reliable boot (per `qa-repro-report.md`): `yarn install` → `yarn build:packages` → `yarn turbo run generate` → `yarn build:packages` → `next dev -p 3100` in `apps/mercato`. Or ephemeral: `yarn test:integration:ephemeral:start`.
- Admin login: `admin@acme.com` / `secret`.
- Sales specs need `yarn mercato auth sync-role-acls` so the dev tenant's admin has sales features.
- **Default-ON** — nothing to enable. For the opt-out section, set `OM_OPTIMISTIC_LOCK=off` and reboot.

**GOLDEN RULES (apply to every conflict case)**
1. A conflict needs **two independent contexts** — two browser tabs of the *same* session **or** two
   users in separate sessions/incognito. A single tab re-fetches the version on focus and **cannot**
   reproduce a conflict by itself.
2. **Recipe:** Tab A: edit a field + **Save** (succeeds, version advances). Tab B (still stale): edit
   a field / click Delete + **Save/Confirm** → **expect the "Record changed" bar**; the stale write is
   **refused** (no silent overwrite / no silent delete).
3. **Pass** = stale action refused with the localized bar; the **fresh** action (Tab A, or Tab B after
   Refresh) succeeds; copy is localized (never the raw token `record_modified`).
4. **No false positives**: a normal **single-tab** edit + Save must **never** 409.

**Playwright driving notes**
- Use two `browser.newContext()` (separate storage states) for the "two users / two tabs" split, or two pages in one context.
- Assert the bar via the visible title text (`Record changed`) and/or the network `409` with
  `code: 'optimistic_lock_conflict'`. Set request interception/`page.on('response')` to capture the 409 body.
- To force a deterministic stale token without a second click, you may PUT an out-of-band edit via the API
  (admin session) between Tab A load and Tab B save — mirrors what the automated specs do.

---

## 3. Conflict-bar UX (the shared surface) — E-series

| Case | Steps | Expected |
|---|---|---|
| LOCK-M-UX-01 | Trigger any conflict (e.g. LOCK-M-CRM-01) | A persistent **red bar** with title **"Record changed"** appears at the top (in `AppShell`), **not** a toast |
| LOCK-M-UX-02 | On the bar, click **Refresh** | Page/record refetches to the latest version; you can re-apply your change and Save succeeds |
| LOCK-M-UX-03 | After triggering the bar, **do nothing** | Bar **persists** (does not auto-vanish like a toast) until Refresh/Dismiss/navigation |
| LOCK-M-UX-04 | Trigger the bar, then **navigate to an unrelated module** (e.g. Dashboard) | Bar **auto-clears** on route change (round-3 fix — must NOT linger across modules) |
| LOCK-M-UX-05 | Click **Dismiss** on the bar | Bar closes; no further action taken; record unchanged |
| LOCK-M-UX-06 | Switch app language to **de / es / pl**, re-trigger a conflict | Title, Refresh, Dismiss, and message are **translated**; never the raw `record_modified` |
| LOCK-M-UX-07 | Trigger a conflict; inspect the network 409 | Body is `{ error, code: 'optimistic_lock_conflict', currentUpdatedAt, expectedUpdatedAt }` |

---

## 4. Customers / CRM — C-series
Live edit pages are **v2** (`companies-v2`, `people-v2`); v1 are dead edit routes (see §15 negatives).
Hand-wired readers: `customers.company`, `customers.person`/`people`. Deals + interactions via generic/command path.

| Case | Surface / Route | Scenario (Tab A → Tab B) | Expected | Auto-spec |
|---|---|---|---|---|
| LOCK-M-CRM-01 | Company edit `/backend/customers/companies-v2/<id>` | A edits name+Save → B edits a field+Save | B → bar; A persisted | TC-LOCK-OSS-001/005 |
| LOCK-M-CRM-02 | Company **same user, two tabs** (not two users) | A edit+Save → B (stale) edit+Save | B → bar (proves it's not only cross-user) | — |
| LOCK-M-CRM-03 | Company **delete** | A edits+Save → B clicks Delete | B delete → bar (no silent delete) | TC-LOCK-OSS-005 |
| LOCK-M-CRM-04 | Person edit `/backend/customers/people-v2/<id>` | A edit+Save → B edit+Save | B → bar | TC-LOCK-OSS-002/005 |
| LOCK-M-CRM-05 | Person **delete** | A edits+Save → B Delete | B → bar | TC-LOCK-OSS-005 |
| LOCK-M-CRM-06 | Deal edit `/backend/customers/deals/<id>` (or deal form) | A edit+Save → B edit+Save | B → bar | TC-LOCK-OSS-005 |
| LOCK-M-CRM-07 | Deal **delete** (list single delete) `/backend/customers/deals` | A edits+Save → B deletes the row | B → bar | — |
| LOCK-M-CRM-08 | Deals **kanban** Won/Lost `/backend/customers/deals/pipeline` | A marks deal Won in A → B marks same deal (stale) | B → bar | — |
| LOCK-M-CRM-09 | Deals **kanban drag** to another stage | A drags deal to stage X → B drags stale deal | B → bar | — |
| LOCK-M-CRM-10 | **Activity / Task** edit modal (`ScheduleActivityDialog`) opened from a People/Deal tab | A edits the activity+Save → B (stale modal) edits+Save | B → bar (round-3 fix: header now sent from the dialog) | TC-LOCK-OSS-009 |
| LOCK-M-CRM-11 | Activity/Task **delete-after-delete** | A deletes the task → B saves the stale modal | B → **bar** (NOT generic `Interaction not found` / 404 — `enforceRecordGoneIsConflict`) | TC-LOCK-OSS-009 |
| LOCK-M-CRM-12 | Task **mark done** / **cancel** from a stale tab | A edits/advances the task → B clicks Mark done / Cancel | B → bar | TC-LOCK-OSS-009 |
| LOCK-M-CRM-13 | **Timeline delete** (interaction timeline) | A edits → B deletes from the timeline (stale) | B → bar | TC-LOCK-OSS-009 |

> @alinadivante round-3 caveat: sub-record modals (tasks/activities) were the last CRM gap; LOCK-M-CRM-10..13 are exactly those fixes — exercise them carefully.

---

## 5. Catalog — K-series
Product update + variant + category wired; price/offer/unit-conversion **leak fixes** must NOT 409 on single-tab saves.

| Case | Surface / Route | Scenario | Expected | Auto-spec |
|---|---|---|---|---|
| LOCK-M-CAT-01 | Product edit `/backend/catalog/products/<id>` | A edit+Save → B edit+Save | B → bar | TC-LOCK-OSS-006 |
| LOCK-M-CAT-02 | Variant edit `/backend/catalog/products/<productId>/variants/<variantId>` | A edit+Save → B edit+Save | B → bar | — |
| LOCK-M-CAT-03 | Variant **delete** (stale) | A edits product/variant+Save → B deletes the variant | B → **bar** (round-3 fix — was a generic error before) | TC-LOCK-OSS-010 |
| LOCK-M-CAT-04 | Variant **concurrent delete → not-found UI** | Delete the variant in A; open/refresh it in B | B shows **RecordNotFoundState**, NOT an empty form with `not_found` console errors | TC-LOCK-OSS-012 |
| LOCK-M-CAT-05 | Category edit `/backend/catalog/categories/<id>/edit` | A edit+Save → B edit+Save | B → bar (round-3 fix: category GET now returns `updatedAt`) | — |
| LOCK-M-CAT-06 | Category **stale delete** | A edits+Save → B deletes the category | B → bar | — |
| LOCK-M-CAT-07 | Option-schema two-tab edit + stale delete | A edit+Save → B edit/delete | B → bar | — |
| LOCK-M-CAT-08 | **FALSE-POSITIVE guard:** variant **with price overrides**, single tab | Edit + Save **once** in one tab only | ✅ saves cleanly, **NO false 409** (price sync sends each price's own version) | — |
| LOCK-M-CAT-09 | **FALSE-POSITIVE guard:** product with **channel offers / unit conversions**, single tab | Edit + Save once | ✅ saves cleanly, no false 409 | — |
| LOCK-M-CAT-10 | **Price kinds settings** (`PriceKindSettings`) two-tab edit | A edit+Save → B edit+Save | B → bar (custom `buildOptimisticLockHeader` POST/PUT/DELETE) | — |

---

## 6. Sales — S-series
Order/quote header + delete on the shared `sales/documents/[id]` page; sub-sections via `enforceSalesDocumentOptimisticLock` (document-aggregate); payments/shipments are **row-level**. Hand-wired reader: `sales.order`.

| Case | Surface | Scenario | Expected | Auto-spec |
|---|---|---|---|---|
| LOCK-M-SAL-01 | Order header `/backend/sales/orders/<id>` (change currency/dates/customer/channel/comment/addresses/status) | A edit+Save → B edit+Save | B → bar + order refreshes | TC-LOCK-OSS-003/007 |
| LOCK-M-SAL-02 | Quote header `/backend/sales/quotes/<id>` | A edit+Save → B edit+Save | B → bar | — |
| LOCK-M-SAL-03 | Order **delete** (stale) | A edits+Save → B clicks Delete | B → bar (no redirect/silent delete) | TC-LOCK-OSS-007 |
| LOCK-M-SAL-04 | Order → **Items / line** add/edit | A adds/edits a line (order version advances) → B adds/edits a line (stale) | B → bar (document-aggregate) | TC-LOCK-OSS-008 |
| LOCK-M-SAL-05 | Order → **Adjustments** add/edit/delete | A mutates an adjustment → B mutates (stale) | B → bar | — |
| LOCK-M-SAL-06 | Order → **Returns** create | A creates a return / edits doc → B creates a return (stale) | B → bar | — |
| LOCK-M-SAL-07 | Order → **Payments** add/edit | A mutates → B mutates (stale) | B → bar (**row-level** — payment row's own version) | — |
| LOCK-M-SAL-08 | Order → **Shipments** add/edit/delete | A mutates → B mutates (stale) | B → bar (row-level) | — |
| LOCK-M-SAL-09 | **Quote → Convert to order** | A edits the quote+Save → B clicks Convert (stale) | B → bar (closes the #2114 accept/convert race) | — |
| LOCK-M-SAL-10 | **FALSE-POSITIVE guard:** open the same order in a 2nd tab, **make no change** | Later Save in tab A | ✅ A still saves — opening a 2nd tab must NOT later cause a spurious `Record changed` (round-3 fix: order GET is side-effect-free; totals recalc on a forked EM) | TC-LOCK-OSS-011 |
| LOCK-M-SAL-11 | Sales **channel** edit `/backend/sales/channels/<channelId>/edit` (`ChannelOfferForm`) | A edit+Save → B edit+Save | B → bar | — |
| LOCK-M-SAL-12 | Sales **channel** broken-state delete (Alina's original repro) | A edits/saves a channel → B deletes the same channel from the list | List refreshes correctly; the deleted channel does **not** linger; opening it does **not** leave an empty form with `Failed to load channel` / `not_found` | — |
| LOCK-M-SAL-13 | Channel **offer** edit + offers **list delete** (stale) | A edits an offer → B deletes from the offers list (stale) | B → bar + list refreshes | — |
| LOCK-M-SAL-14 | **Payment methods** settings (`PaymentMethodsSettings`) two-tab edit | A edit+Save → B edit+Save | B → bar | — |
| LOCK-M-SAL-15 | **Shipping methods** settings (`ShippingMethodsSettings`) two-tab edit | A edit+Save → B edit+Save | B → bar | — |
| LOCK-M-SAL-16 | **Tax rates** settings (`TaxRatesSettings`) two-tab edit | A edit+Save → B edit+Save | B → bar | — |

---

## 7. Auth & Access Control — A-series
Security-sensitive. ACL grant saves are version-checked + transactional; `User`/`Role` gained `updated_at`.

| Case | Surface | Scenario | Expected |
|---|---|---|---|
| LOCK-M-AUTH-01 | Role edit `/backend/roles/<id>` (role **name**) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-AUTH-02 | Role **ACL / permissions** (`/api/auth/roles/acl`) | A toggles a feature+Save → B toggles a feature+Save (stale) | B → bar; A's grant **not** clobbered (`enforceCommandOptimisticLock`) |
| LOCK-M-AUTH-03 | User edit `/backend/users/<id>` | A edit+Save → B edit+Save | B → bar |
| LOCK-M-AUTH-04 | User **ACL overrides** (`/api/auth/users/acl`) | A toggles a feature → B toggles (stale) | B → bar |
| LOCK-M-AUTH-05 | Role / User **delete** (stale) | A edits+Save → B deletes | B → bar |
| LOCK-M-AUTH-06 | **Customer account user** `/api/customer_accounts/admin/users/[id]` PUT/DELETE | A edit+Save → B edit/delete (stale) | B → bar |
| LOCK-M-AUTH-07 | **Customer account role** `/backend/customer_accounts/roles/<id>` + admin roles `[id]` PUT/DELETE | A edit+Save → B edit/delete (stale) | B → bar |
| LOCK-M-AUTH-08 | **Sidebar customization** (`SidebarCustomizationEditor`, `/api/auth/sidebar/preferences`) | A saves a layout → B saves a stale layout | B → bar (custom `buildOptimisticLockHeader` PATCH) |

---

## 8. Staff — T-series

| Case | Surface | Scenario | Expected |
|---|---|---|---|
| LOCK-M-STF-01 | Team edit (`TeamForm`) + stale **list delete** | A edit+Save → B edit/delete | B → bar |
| LOCK-M-STF-02 | Team-role edit `/backend/staff/team-roles/<id>/edit` (`TeamRoleForm`) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-STF-03 | Team **member** edit (`TeamMemberForm`) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-STF-04 | Leave request `/backend/staff/my-leave-requests/<id>` (`LeaveRequestForm`) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-STF-05 | **Job History** nested edit (`JobHistorySection`) | A edits a job-history row → B edits stale | B → bar (uses custom key `staff.teamMembers.detail.jobHistory.conflict`) |
| LOCK-M-STF-06 | Job History **fresh single-tab** edit (regression of #2306) | Single tab: edit + Save | ✅ 200, **no** spurious `400 Bad Request on updatedAt` (note: #2306 tracked separately in #2321) |

---

## 9. Resources & Planner — R-series

| Case | Surface | Scenario | Expected |
|---|---|---|---|
| LOCK-M-RES-01 | Resource edit `/backend/resources/resources/<id>` (`ResourceCrudForm`) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-RES-02 | Resource-type edit `/backend/resources/resource-types/<id>/edit` | A edit+Save → B edit+Save | B → bar |
| LOCK-M-RES-03 | Resource **stale delete** | A edits+Save → B deletes | B → bar |
| LOCK-M-PLN-01 | Planner availability ruleset `/backend/planner/availability-rulesets/<id>` (`AvailabilityRuleSetForm`) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-PLN-02 | Planner **availability schedule** (`AvailabilitySchedule`) per-rule edit | A edits a rule → B edits stale | B → bar (note: coexists with selective-delete #2325) |

---

## 10. Directory, Config & misc CRUD — D-series
All via generic `makeCrudRoute` reader or explicit `enforceCommandOptimisticLock`.

| Case | Surface | Scenario | Expected |
|---|---|---|---|
| LOCK-M-DIR-01 | Organization edit `/backend/directory/organizations/<id>/edit` | A edit+Save → B edit+Save | B → bar |
| LOCK-M-DIR-02 | Tenant edit `/backend/directory/tenants/<id>/edit` (`TenantForm`) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-CUR-01 | Currency edit `/backend/currencies/<id>` | A edit+Save → B edit+Save | B → bar |
| LOCK-M-CUR-02 | Exchange-rate edit `/backend/exchange-rates/<id>` | A edit+Save → B edit+Save | B → bar |
| LOCK-M-FT-01 | Feature toggle **global override** `/backend/feature-toggles/global/<id>/edit` + `/api/feature_toggles/overrides` PUT/DELETE | A edit+Save → B edit/delete (stale) | B → bar |
| LOCK-M-DICT-01 | Dictionary `/api/dictionaries/<id>` PUT/DELETE | A edit+Save → B edit/delete (stale) | B → bar |
| LOCK-M-DICT-02 | Dictionary **entry** `/api/dictionaries/<id>/entries/<entryId>` PUT/DELETE | A edit+Save → B edit/delete (stale) | B → bar |
| LOCK-M-BR-01 | Business rule `/backend/rules/<id>` (`RuleForm`) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-BR-02 | Business rule **set** `/backend/sets/<id>` (`RuleSetForm`) | A edit+Save → B edit+Save | B → bar |
| LOCK-M-PSP-01 | Saved view / **perspective** save (`perspectiveService.savePerspective`) | A saves a view → B saves stale | B → bar |
| LOCK-M-INB-01 | Inbox-ops **settings** `/api/inbox_ops/settings` PUT/DELETE | A edit+Save → B edit/delete (stale) | B → bar |
| LOCK-M-WHK-01 | Webhook `/api/webhooks/<id>` PUT/DELETE | A edit+Save → B edit/delete (stale) | B → bar |
| LOCK-M-SYNC-01 | Data-sync **schedule** (`sync-schedule-service.saveSchedule`) | A saves a schedule → B saves stale | B → bar |
| LOCK-M-CHK-01 | Checkout **payment link** (`checkout/commands/links.updatePaymentLink`) | A edit+Save → B edit (stale) | B → bar |
| LOCK-M-CHK-02 | Checkout **template** (`checkout/commands/templates.updateCheckoutTemplate`) | A edit+Save → B edit (stale) | B → bar |
| LOCK-M-WF-01 | Workflow **definition** `/api/workflows/definitions/<id>` (`workflows.definition` reader) | A edit+Save → B edit (stale) | B → bar |
| LOCK-M-ENT-01 | Custom-entity record `/backend/entities/user/<entityId>/records/<recordId>` | A edit+Save → B edit+Save | B → bar |

---

## 11. Generic CRUD smoke (auto-registered reader) — G-series
The `makeCrudRoute` factory auto-registers a generic reader for **every** CRUD entity
(`packages/shared/src/lib/crud/factory.ts` ~L940). Spot-check 3–4 entities **not** explicitly
listed above to prove universal coverage.

| Case | Steps | Expected |
|---|---|---|
| LOCK-M-GEN-01 | Pick any other `makeCrudRoute`-backed entity edited via CrudForm; two-tab edit | B → bar |
| LOCK-M-GEN-02 | API probe: GET a record, PUT with a **stale** `x-om-ext-optimistic-lock-expected-updated-at` | **409** with structured body |
| LOCK-M-GEN-03 | API probe: same PUT **without** the header | **200** (additive — no 409) |

---

## 12. Negative / additive / opt-out — N-series

| Case | Steps | Expected |
|---|---|---|
| LOCK-M-NEG-01 | **Header-less API client** PUT/DELETE on any locked entity | Always **passes** (no 409) — strictly additive contract |
| LOCK-M-NEG-02 | Set `OM_OPTIMISTIC_LOCK=off`, reboot; re-run any conflict case above | **No 409 anywhere**; last-write-wins (feature disabled) |
| LOCK-M-NEG-03 | `OM_OPTIMISTIC_LOCK` **unset** (default) | Feature **ON** — conflicts fire |
| LOCK-M-NEG-04 | **v1 dead edit routes** `/backend/customers/companies/<id>` and `/people/<id>` | These are not the live editors (list rows route to `*-v2`); confirm they are not used for editing — only `/create` links to v1. Not a lock bug if v1 lacks the bar |
| LOCK-M-NEG-05 | **Back-to-back saves** in one tab (save, then immediately edit + save again) | Both succeed — the PUT response returns a fresh `updatedAt` the form re-captures; **no false 409** (TC-LOCK-OSS-011) |
| LOCK-M-NEG-06 | After a conflict, click **Refresh** then re-apply + Save | Succeeds against the latest version |

---

## 13. Documented EXEMPTIONS — do **not** file these as bugs
(from `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`, run-folder docs, and follow-ups #2215/#2232)

- **Bulk operations** — no single version token; intentionally excluded.
- **Integrations marketplace** — stateless endpoints, no DB `updated_at` (verified no-code).
- **Notification Delivery settings** — singleton blob, not row-based.
- **Scheduled Jobs** — already protected via `makeCrudRoute` + CrudForm.
- **System/User custom-entity *definition* batch upsert** — deferred (coupled to EAV scope bug #2411; resolved upstream by #2415).
- **Enterprise pessimistic record-locks** for workflow/catalog/staff/resources action endpoints — deferred to enterprise FR **#2232**.
- **#2306 Job History** fresh-update 400 — tracked separately in **#2321** (out of scope here; see LOCK-M-STF-06 as a watch-item only).
- When the enterprise `record_locks` module is enabled, the pessimistic acquire runs at a **higher
  guard priority** and dominates — so a "same lock owner" may not 409 via the OSS path. Test pure OSS
  (enterprise disabled) for the cases above, or account for this when interpreting same-user results.

---

## 14. Automated coverage already green (reference)
Manual QA need only re-prove the **UI** behaviors; the API path is locked by these specs
(run: `BASE_URL=<app> OM_OPTIMISTIC_LOCK=all yarn test:integration -g "TC-LOCK-OSS"`).

| Spec | Entity / scenario |
|---|---|
| TC-LOCK-OSS-001 | `customers.company` — opt-in / fresh / stale-PUT → 409 |
| TC-LOCK-OSS-002 | `customers.person` — polymorphic discriminator |
| TC-LOCK-OSS-003 | `sales.order` — stale PUT → 409 |
| TC-LOCK-OSS-004 | `customers.deal` — generic auto-registered reader + stale DELETE → 409 |
| TC-LOCK-OSS-005 | company/person/deal — two-session concurrent edit |
| TC-LOCK-OSS-006 | `catalog.product` — generic reader |
| TC-LOCK-OSS-007 | `sales.order` — concurrent edit + stale DELETE |
| TC-LOCK-OSS-008 | `sales.order` line — document-aggregate parent-version check |
| TC-LOCK-OSS-009 | `customers.interaction` (tasks) — stale edit + delete-after-delete → 409 |
| TC-LOCK-OSS-010 | `catalog.variant` — stale DELETE → 409 |
| TC-LOCK-OSS-011 | `sales.order` — response token refresh (no false-positive back-to-back) |
| TC-LOCK-OSS-012 | `catalog.variant` — RecordNotFoundState on concurrent delete |
| TC-LOCK-OSS-013 | `customer_accounts.user` — custom route PUT/DELETE opt-in / stale → 409 |

---

## 15. Traceability — reviewer findings → cases

### @alinadivante 2026-05-27 (round 2)
| Finding | Covered by |
|---|---|
| Same-user two-tab company save still succeeds | LOCK-M-CRM-02 |
| Flash shows raw `record_modified` | LOCK-M-UX-06 / LOCK-M-UX-01 |
| people-v2 unprotected | LOCK-M-CRM-04/05 |
| deals editable concurrently | LOCK-M-CRM-06..09 |
| catalog.products editable concurrently | LOCK-M-CAT-01 |
| sales.orders overwrite silently | LOCK-M-SAL-01 |
| Sales channel edit/delete broken state | LOCK-M-SAL-12 |

### @alinadivante 2026-05-31 (round 3)
| Finding | Covered by |
|---|---|
| Tasks/activities sub-records editable concurrently | LOCK-M-CRM-10/12 |
| Deleted item + stale modal → `Interaction not found`/404 | LOCK-M-CRM-11 |
| Categories editable concurrently + stale delete | LOCK-M-CAT-05/06 |
| Product variant stale delete possible | LOCK-M-CAT-03 |
| Possible false-positive conflict opening an order in a 2nd tab | LOCK-M-SAL-10 |
| Conflict bar persists across navigation | LOCK-M-UX-04 |

### @pkarw manual QA guides (2026-05-31 + 2026-06-01)
- Guide-1 sections A–F → §4 (CRM), §5 (Catalog), §6 (Sales incl. sub-sections + convert + channel delete), §3 (bar UX), §11 (cross-module regression).
- Guide-2 sections A–F → §7 (Auth/ACL), §5 B2/B3 false-positive (LOCK-M-CAT-08/09), §4 kanban (LOCK-M-CRM-08/09), §6 sub-sections, §8–10 (staff/resources/planner), §12 opt-out.

---

## 16. Running this plan with Playwright (MCP / scripted)

1. Boot the branch app (see §2). Confirm a stale-PUT API probe returns 409 first (LOCK-M-GEN-02) — proves the env is ON.
2. For each conflict case: open two contexts/pages, perform Tab A edit+Save, then Tab B stale action,
   and assert the **"Record changed"** bar text is visible AND a `409` with `code: 'optimistic_lock_conflict'`
   was returned. For false-positive cases (LOCK-M-CAT-08/09, LOCK-M-SAL-10, LOCK-M-NEG-05) assert the bar is **absent** and the Save returns **200**.
3. For localization (LOCK-M-UX-06) switch locale and re-assert the translated strings.
4. Capture a screenshot of the bar for each major module (CRM, Catalog, Sales) as evidence.
5. Promote any genuinely new gap into an executable `TC-LOCK-OSS-0xx.spec.ts` under the owning module's `__integration__/`.

---

## Notes
- Master plan only — **not** an executable spec. Executable coverage lives in the `TC-LOCK-OSS-001…013` specs.
- Per `.ai/qa/AGENTS.md`, executable `.spec.ts` files must live in module `__integration__/` folders, never under `.ai/qa/tests`.
