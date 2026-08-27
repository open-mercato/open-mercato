# Customer Users Table Column Sorting

## 📝 TLDR

Operators managing customer portal accounts at `/backend/customer_accounts/users` cannot order the list at all — the admin API hard-codes `orderBy: { createdAt: 'DESC' }` and the page never passes sorting props to `DataTable`. This spec adds server-side, pagination-correct column sorting to that table. The design's one genuinely hard problem is that `email` and `display_name` on `customer_accounts:customer_user` are **encrypted at rest by default**, so a SQL `ORDER BY` on those columns orders ciphertext; they get a separate bounded decrypt-then-sort path, while the plaintext columns sort natively in Postgres.

Source: FR [#5672](https://github.com/open-mercato/open-mercato/issues/5672).

## 📝 Resolved assumptions (autonomous defaults)

This spec was written by `om-spec-writing --autonomous`. The Open Questions raised at the skeleton gate were resolved as follows. Each is reversible; override any of them before merge.

| # | Question | Resolved answer | Rationale |
|---|----------|-----------------|-----------|
| Q1 | How do the encrypted `Name` and `Email` columns sort, given a SQL `ORDER BY` would order ciphertext? | **Hybrid.** Plaintext columns (`Verified`, `Status`, `Last Login`, `Created`) sort natively via `orderBy`. `Name` and `Email` take a bounded decrypt-then-sort path over the filtered set, capped at `CUSTOMER_USERS_ENCRYPTED_SORT_MAX` (default 5000); past the cap the response degrades to the default order and flags it. ⚠ **NEEDS HUMAN CONFIRMATION** | The FR names `Name` as a mandatory regression-tested column, so dropping it is not "shipping the ask". The alternatives are worse: a persisted plaintext sort column defeats the encryption it would index, and a page-only client sort silently lies about ordering across pages. The cap is a single env-tunable constant, so the performance trade-off is reversible without a schema or contract change — but it *is* a real per-request cost on large tenants, which is why it is flagged for human sign-off. |
| Q2 | Should the `Role` column be sortable? | **No — deferred.** `Role` renders as an unsorted affordance-free header. | `roles` is a multi-valued junction (`CustomerUserRole`) with no well-defined single sort key — "sort by role" is ambiguous the moment a user holds two roles. The FR says "applicable columns"; a multi-valued relation is not one. Deferring costs nothing and avoids inventing a semantic (min-role-name) users did not ask for. |
| Q3 | Should the active sort be mirrored into the URL, as the CRM People/Companies lists do? | **No.** Sort lives in component state and is persisted by the existing perspectives (saved views) mechanism only. | Smallest scope that satisfies the FR's "must work with saved table views" requirement — `DataTable`'s `applyPerspectiveSettings` already calls `onSortingChange`, so saved views work with no extra code. URL sync is a purely additive follow-up if deep-linkable sort is later wanted. |
| Q4 | Should the portal-facing route (`api/portal/users.ts`) accept the same sort params? | **No — admin route only.** | The FR scopes itself to the backoffice table. Widening to a second route doubles the contract surface and the test matrix for no stated need. |
| Q5 | What is the ordering when no sort is requested? | **Unchanged — `createdAt DESC`**, now with an explicit `id DESC` tiebreak. | Preserves the current response contract for every existing caller. The tiebreak is a latent-bug fix, not a behavior change (see Edge Cases). |

No question required splitting this spec: column sorting on one table is a single independently deployable capability.

## 📝 Problem Statement

`/backend/customer_accounts/users` is the only place staff manage customer portal accounts. Today the list is frozen in "newest first" order:

- `packages/core/src/modules/customer_accounts/api/admin/users.ts:156` — `orderBy: { createdAt: 'DESC' }` is a literal, and the route's query parsing (lines 40–46) reads `page`, `pageSize`, `status`, `customerEntityId`, `personEntityId`, `roleId`, `search` and nothing else.
- `packages/core/src/modules/customer_accounts/backend/customer_accounts/users/PortalUsersPageClient.tsx:538` — the `DataTable` receives `columns`, `data`, search, filters, perspective and pagination, but none of `sortable`, `manualSorting`, `sorting`, `onSortingChange`.

The practical cost: an operator looking for the least-recently-active accounts, or scanning alphabetically for a person whose exact spelling they do not know, has to page through the whole list. Every comparable list in the product already sorts — the CRM People and Companies lists (`packages/core/src/modules/customers/backend/customers/people/page.tsx:924-926`) do, as do the WMS, EUDR and query-index tables — so the absence here reads as a gap, not a decision.

## 📝 Proposed Solution

Wire the page into `DataTable`'s existing manual-sorting contract and teach the admin list route a `sortField` / `sortDir` pair, mirroring the naming the CRM lists already established (`packages/core/src/modules/customers/backend/customers/listSorting.ts`).

The non-obvious half is the encryption boundary. `packages/core/src/modules/customer_accounts/encryption.ts:6-9` declares `email` (with an `email_hash` blind index) and `display_name` as encrypted fields on `customer_accounts:customer_user`, and `isTenantDataEncryptionEnabled()` (`packages/shared/src/lib/encryption/toggles.ts`) **defaults to enabled** when `TENANT_DATA_ENCRYPTION` is unset. `findAndCountWithDecryption` passes `options` — including `orderBy` — straight through to `em.findAndCount` and only decrypts the rows the database already chose and ordered. So `ORDER BY display_name` sorts ciphertext: stable, deterministic, and meaningless to a human.

This is the same wall the route's own search already hit — it routes partial matches through `search_tokens` precisely because "ILIKE on the ciphertext never matches a plaintext search term" (comment at `users.ts:73-75`). Sorting has no token-table equivalent, because tokens are hashed and hashes do not preserve order.

Three alternatives were considered and rejected:

- **Persist a sortable plaintext (or order-preserving) column.** Storing a sort key derived from a name reintroduces exactly the plaintext the encryption map exists to remove, and order-preserving encryption leaks the distribution. It also needs a migration and a backfill. Rejected on security grounds; `packages/core/AGENTS.md` forbids hand-rolled crypto outright.
- **Client-side sort of the loaded page.** Free to build and actively misleading: with `pageSize: 50` and 300 users, "sort by name ascending" would sort 50 arbitrary rows and present them as the alphabetical top of the list.
- **Drop `Name`/`Email` from the sortable set.** Honest and cheap, but it fails the FR's explicit acceptance criterion ("a regression test should verify ascending and descending sorting for at least the `Name` and `Created` columns").

The chosen hybrid keeps the cheap path cheap and pays the decryption cost only when a user actually asks to sort by an encrypted column, with a hard ceiling so a large tenant degrades visibly instead of timing out.

## 📝 Architecture

Three units change; no module boundary is crossed and no new dependency is introduced.

**1. Sort-field resolver — `packages/core/src/modules/customer_accounts/backend/customer_accounts/users/listSorting.ts` (new, client-side).**

A pure module mirroring `customers/backend/customers/listSorting.ts`: maps a `DataTable` column id to the API's `sortField` token and appends `sortField`/`sortDir` to a `URLSearchParams`. Unmapped column ids return `null` and append nothing, so an injected or removed column can never produce a malformed request.

**2. Admin list route — `packages/core/src/modules/customer_accounts/api/admin/users.ts` (modified).**

Parses and validates `sortField`/`sortDir` with zod, then branches:

- **Plaintext branch** (`emailVerified`, `isActive`, `lastLoginAt`, `createdAt`): builds a MikroORM `orderBy` and keeps the existing single `findAndCountWithDecryption` call with `limit`/`offset`. One query, unchanged cost.
- **Encrypted branch** (`displayName`, `email`): counts the filtered set first; if it is at or under `CUSTOMER_USERS_ENCRYPTED_SORT_MAX`, loads that set through `findWithDecryption` (which decrypts in place), sorts the decrypted values in JS, and slices the requested page. Over the cap, it falls back to the default ordering and sets `sortDegraded: true` on the response.

Both branches append a deterministic `id` tiebreak.

**3. List page client — `PortalUsersPageClient.tsx` (modified).**

Holds `sorting: SortingState`, feeds it into `queryParams` via the resolver, resets `page` to 1 whenever sorting changes, and passes `sortable` / `manualSorting` / `sorting` / `onSortingChange` to `DataTable`. Columns opt out individually with `enableSorting: false` (`roles`). When the response carries `sortDegraded`, the page surfaces a translated inline notice.

**Saved views come for free.** `DataTable.applyPerspectiveSettings` already restores `settings.sorting` and calls `onSortingChange?.(sortingState)` (`packages/ui/src/backend/DataTable.tsx:1893+`), and `perspectiveSettingsSchema` already persists a `sorting` array (`packages/core/src/modules/perspectives/data/validators.ts:12-15`). Once the page is a controlled sorting host, saving and applying a view carries sort with it. No perspectives change is in scope.

## 📝 Data Model

**No schema change. No migration. No new entity.** Every sortable value already exists on `CustomerUser`: `emailVerifiedAt`, `isActive`, `lastLoginAt`, `createdAt`, plus the encrypted `email` and `displayName`.

Sensitive-data handling is the load-bearing constraint rather than an afterthought:

- Decrypted names and emails exist only in request-scoped memory inside the encrypted branch, exactly as they already do for the rows of any listed page — the branch widens *how many* rows are decrypted per request, never *who* may see them or where they are persisted.
- Every query in both branches keeps the existing `tenantId` / `organizationId` / `deletedAt: null` scoping in `where`; the sort branch composes onto that `where`, it does not replace it.
- Nothing derived from a decrypted value is cached, logged, or written back.

## 📝 API Contracts

`GET /api/customer_accounts/admin/users` gains two optional query parameters. Both are additive; omitting them reproduces today's behavior byte for byte.

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `sortField` | `'displayName' \| 'email' \| 'emailVerified' \| 'isActive' \| 'lastLoginAt' \| 'createdAt'` | unset | Unrecognized values are **ignored**, not rejected |
| `sortDir` | `'asc' \| 'desc'` | `'desc'` | Only meaningful alongside a valid `sortField` |

Validated with zod alongside the existing schema and reflected in the route's `openApi.methods.GET.query` block so the generated API docs stay accurate.

**Invalid `sortField` is ignored rather than 400.** A saved perspective can outlive the column it references — a view saved before a column was renamed or removed would otherwise hard-fail the whole list page. Falling back to the default order degrades a stale view into a working list.

Response shape is unchanged except for one additive, optional field:

```jsonc
{
  "ok": true,
  "items": [ /* unchanged */ ],
  "total": 128,
  "totalPages": 3,
  "page": 1,
  "sortDegraded": true   // present ONLY when an encrypted sort exceeded the cap
}
```

`sortDegraded` is optional and absent on every existing code path, so no current consumer's parsing changes. Per `BACKWARD_COMPATIBILITY.md` this is an additive response field on a STABLE surface — permitted without a deprecation cycle.

**Configuration.** `CUSTOMER_USERS_ENCRYPTED_SORT_MAX` (integer, default `5000`) bounds the encrypted branch. It is read with the shared `parseNumberWithDefault(raw, 5000, { integer: true, min: 0 })` from `@open-mercato/shared/lib/number` — never a hand-rolled `parseInt`, per `packages/shared/AGENTS.md`. It must be documented in `apps/mercato/.env.example`, which per the root Task Router obliges mirroring into the create-app template in the same change (`yarn template:sync:fix`).

## 📝 UI/UX

Standard `DataTable` sorting chrome — clickable header, direction indicator, `aria-sort` — is supplied by the shared component and is not redesigned here. Only what is specific to this table:

- **Sortable:** Name, Email, Verified, Status, Last Login, Created.
- **Not sortable:** Roles (Q2) and the actions column. These render as plain headers with no click affordance, because `DataTable` only renders the sort button for columns where `getCanSort()` is true (`DataTable.tsx:3392`) — an unsortable column looks inert rather than broken.
- **Changing sort returns to page 1.** Staying on page 7 of a freshly reordered list shows rows the user has no mental model for.
- **Degraded-sort notice.** When `sortDegraded` is true, the page shows a translated inline message under the table header explaining that alphabetical sorting is unavailable for this many accounts and suggesting narrowing with search or filters. It uses the existing status-token styling; no new component.
- **i18n.** The one new user-facing string is added to `customer_accounts` locale files under `customer_accounts.admin.sort.*` and read with `useT()` — never inlined.

Sorting composes with search, status/role filters, organization scope and pagination because all of them already flow through the same `queryParams` memo; sorting joins that memo rather than sitting beside it.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| Encrypted sort over a filtered set larger than the cap | Response falls back to `createdAt DESC` and sets `sortDegraded: true`; the UI explains it. Never a timeout, never a silent wrong order. |
| Encryption disabled (`TENANT_DATA_ENCRYPTION=false`) | The encrypted branch still runs and still sorts correctly — it sorts the values as decrypted, and with encryption off those are already plaintext. Correctness does not depend on the toggle; only cost does. |
| A row fails to decrypt | `decryptEntitiesWithFallbackScope` leaves the field as-is; the JS comparator treats a non-string as the lowest value and the sort stays total. One unreadable row cannot throw the list. |
| `lastLoginAt` is null (user never signed in) | Nulls sort **last in both directions**, so "most recent login" and "least recent login" both open on real logins rather than a wall of dashes. |
| Ties on the sort key (same `createdAt`, same display name) | A secondary `id` ordering makes paging deterministic. **This fixes a latent bug**: today `createdAt DESC` alone can drop or duplicate rows across page boundaries when timestamps collide, which bulk-created users routinely do. |
| `roleId` filter active (route pre-resolves matching ids into `where.id.$in`) | Unchanged. Sorting composes onto the already-narrowed `where` in both branches. |
| Search active with zero token matches | The existing early return still fires before any sort work — no wasted decryption. |
| A saved view references a column that no longer exists | `resolveCustomerUsersSortField` returns `null`, no sort param is sent, the list renders in default order. |
| Sorting requested by a user without `customer_accounts.view` | Unchanged — the RBAC check at the top of the handler runs before any query parsing. |

## 📝 Risks & Impact Review

**Blast radius: one API route, one page component, one new pure module.** No schema, no entity, no event, no DI key, no widget spot, no ACL feature. Nothing outside `customer_accounts` reads the changed route.

- **Performance (the real risk).** The encrypted branch decrypts up to `CUSTOMER_USERS_ENCRYPTED_SORT_MAX` rows per request. On a tenant with a few hundred portal users this is negligible; at the 5000 ceiling it is a measurable per-request cost that only materializes when an operator actively sorts by Name or Email. Mitigations: the cap itself, the fact that filters and search shrink the set before the branch runs, and env-tunability without a redeploy of logic. This is the assumption flagged ⚠ in Q1.
- **Backward compatibility.** Requests without `sortField` produce the same SQL ordering and the same JSON keys as today. `sortDegraded` is additive and optional. No FROZEN or STABLE surface changes shape.
- **Rollback.** Purely reversible: reverting the three files restores current behavior with no data to migrate back. A partial rollback is available without a deploy — setting `CUSTOMER_USERS_ENCRYPTED_SORT_MAX=0` disables the encrypted branch entirely, degrading Name/Email sorting while leaving the four plaintext columns working.
- **Security.** No new data is exposed to any caller: the encrypted branch decrypts rows the same authenticated, tenant-scoped principal is already entitled to list.

## 📋 Phasing

**Phase 1 — Server-side sorting contract.** The route accepts, validates and honors `sortField`/`sortDir` for all six columns, including the bounded encrypted path. Independently shippable and independently valuable: API consumers get sorting even before the UI exposes it.

**Phase 2 — Table UI.** The page becomes a controlled sorting host, opts columns in and out, resets pagination, and surfaces the degraded-sort notice. Depends on Phase 1.

Each phase leaves the application working; Phase 1 merged alone is a no-op for the UI.

## 📋 Implementation Plan

### Phase 1 — Server-side sorting contract

1. **Add the sort-field allowlist and zod schema to `api/admin/users.ts`.** Define the `sortField` enum and `sortDir` enum, parse both from `url.searchParams`, and resolve invalid or absent values to "no sort". No behavior change yet — the parsed values are unused. *Test:* unit assertions that valid, invalid, and absent inputs resolve as specified.
2. **Add the deterministic tiebreak to the existing default ordering.** Change `orderBy: { createdAt: 'DESC' }` to `{ createdAt: 'DESC', id: 'DESC' }`. *Test:* existing route tests still pass; the assertion on the `orderBy` argument is updated to the new shape.
3. **Implement the plaintext sort branch.** Map `emailVerified → emailVerifiedAt`, `isActive`, `lastLoginAt`, `createdAt` onto a MikroORM `orderBy` with nulls-last semantics and the `id` tiebreak, passed into the existing `findAndCountWithDecryption` call. *Test:* route tests asserting the `orderBy` argument for each plaintext field in both directions.
4. **Implement the bounded encrypted sort branch.** For `displayName`/`email`: count the filtered set; at or under the cap, load it via `findWithDecryption`, sort decrypted values with a locale-aware comparator plus `id` tiebreak, and slice the page; over the cap, fall back to the default order and set `sortDegraded: true`. Read `CUSTOMER_USERS_ENCRYPTED_SORT_MAX` with a clamped default of 5000. *Test:* route tests covering **Name ascending and descending** (the FR's mandated regression), email sorting, the over-cap fallback with its flag, and a row whose decryption left a non-string value.
5. **Update the route's `openApi` GET query schema and response schema** to document `sortField`, `sortDir` and the optional `sortDegraded`. *Test:* the API-docs generation check in the validation gate.
6. **Document `CUSTOMER_USERS_ENCRYPTED_SORT_MAX` in `apps/mercato/.env.example`** and mirror it into the create-app template with `yarn template:sync:fix`. *Test:* the template-sync check in the validation gate.

### Phase 2 — Table UI

7. **Add `backend/customer_accounts/users/listSorting.ts`** exporting `resolveCustomerUsersSortField(columnId)` and `appendCustomerUsersSortParams(params, sorting)`, modeled on the customers module's equivalent. *Test:* a unit suite mirroring `customers/backend/customers/__tests__/listSorting.test.ts` — mapped ids, unmapped ids, empty sorting state, direction mapping.
8. **Make `PortalUsersPageClient` a controlled sorting host.** Add `sorting` state, append the sort params inside the existing `queryParams` memo, reset `page` to 1 on sorting change, and pass `sortable`, `manualSorting`, `sorting`, `onSortingChange` to `DataTable`. Mark the `roles` column `enableSorting: false`. *Test:* a component test asserting the fetched URL carries `sortField`/`sortDir` after a header click and that the page resets to 1.
9. **Surface the degraded-sort notice.** Read `sortDegraded` from the response into state and render the translated inline message; add the string to the `customer_accounts` locale files. *Test:* component test for the notice appearing only when the flag is set; `yarn i18n:check-sync` / `yarn i18n:check-usage` in the gate.
10. **Add integration coverage** per `.ai/qa/AGENTS.md` — a self-contained test that creates its own customer users via the API, sorts by Name ascending and descending and by Created ascending and descending, asserts the returned order, and cleans up its fixtures in teardown.
