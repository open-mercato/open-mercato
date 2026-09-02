# Customer Users Table Column Sorting

## 📝 TLDR

Operators managing customer portal accounts at `/backend/customer_accounts/users` cannot order the list at all — the admin API hard-codes `orderBy: { createdAt: 'DESC' }` and the page never passes sorting props to `DataTable`. This spec adds server-side, pagination-correct column sorting to that table. The design's one genuinely hard problem is that `email` and `display_name` on `customer_accounts:customer_user` are **encrypted at rest by default**, so a SQL `ORDER BY` on those columns orders ciphertext. The platform already solves exactly that problem — `@open-mercato/shared/lib/query/encrypted-sort` plus `mapWithConcurrency`, as used by `customers/api/labels/route.ts` — so the encrypted columns adopt that path rather than inventing a second one, and the plaintext columns sort natively in Postgres.

Source: FR [#5672](https://github.com/open-mercato/open-mercato/issues/5672).

## 📝 Resolved assumptions (autonomous defaults)

This spec was written by `om-spec-writing --autonomous` and revised by `om-auto-fix-pr` after specification review. The Open Questions raised at the skeleton gate were resolved as follows. Each is reversible; override any of them before merge.

| # | Question | Resolved answer | Rationale |
|---|----------|-----------------|-----------|
| Q1 | How do the encrypted `Name` and `Email` columns sort, given a SQL `ORDER BY` would order ciphertext? | **Adopt the platform encrypted-sort path.** Plaintext columns (`Verified`, `Status`, `Last Login`, `Created`) sort natively via `orderBy`. `Name` and `Email` compose the existing `resolveEncryptedSortMaxRows()` + `mapWithConcurrency` + `sortRowsInMemory` helpers over the filtered set, exactly as `customers/api/labels/route.ts:86-110` already does, governed by the existing platform knob `OM_ENCRYPTED_SORT_MAX_ROWS`. | This question originally carried a ⚠ human-confirmation marker because it was framed as "should we build a bounded decrypt-then-sort path, with its own cap and its own default". It is no longer that question. The repository already ships that path, its cap, its concurrency bound, its warning signal and its documentation, and two routes already use it. Reusing it introduces **no new env var, no new default, no new response field and no new comparator** — so there is no novel trade-off left to sign off. The residual cost is identical to the cost the product already accepts on customer labels and interactions, and it is tunable by the same knob that tunes those. See "Why the ⚠ marker was removed" below. |
| Q2 | Should the `Role` column be sortable? | **No — deferred.** `Role` renders as an unsorted affordance-free header. | `roles` is a multi-valued junction (`CustomerUserRole`) with no well-defined single sort key — "sort by role" is ambiguous the moment a user holds two roles. The FR says "applicable columns"; a multi-valued relation is not one. Deferring costs nothing and avoids inventing a semantic (min-role-name) users did not ask for. |
| Q3 | Should the active sort be mirrored into the URL, as the CRM People/Companies lists do? | **No.** Sort lives in component state and is persisted by the existing perspectives (saved views) mechanism only. | Smallest scope that satisfies the FR's "must work with saved table views" requirement — `DataTable`'s `applyPerspectiveSettings` already calls `onSortingChange`, so saved views work with no extra code. URL sync is a purely additive follow-up if deep-linkable sort is later wanted. |
| Q4 | Should the portal-facing route (`api/portal/users.ts`) accept the same sort params? | **No — admin route only.** | The FR scopes itself to the backoffice table. Widening to a second route doubles the contract surface and the test matrix for no stated need. |
| Q5 | What is the ordering when no sort is requested? | **Unchanged — `createdAt DESC`**, now with an explicit `id DESC` tiebreak. | Preserves the current response contract for every existing caller. The tiebreak is a latent-bug fix, deliberately taken (see Edge Cases and API Contracts). |

No question required splitting this spec: column sorting on one table is a single independently deployable capability.

### Why the ⚠ marker was removed

The first draft of this spec gated its own merge on a human confirming Q1, because Q1 proposed building a bounded decrypt-then-sort path with a **new** `CUSTOMER_USERS_ENCRYPTED_SORT_MAX` env var defaulting to 5000, a hand-rolled locale comparator, an unbounded decrypt, and a new `sortDegraded` response field. That was a real architectural trade-off and it deserved the marker.

Specification review found that the platform already provides every one of those pieces, and that two routes in this repository already compose them. Once the design reuses them, each element of the trade-off disappears rather than being decided:

- The cap is `OM_ENCRYPTED_SORT_MAX_ROWS`, which already exists, is already documented, and already governs the same concern elsewhere — so there is no default to pick and no second knob for an operator to discover.
- The decrypt is bounded at the established `DECRYPT_CONCURRENCY = 8` through `mapWithConcurrency`, so the performance profile is the one the product already runs, not a new one.
- The degraded signal is the documented `meta.encryptedSortRowCapWarning`, so no new response semantic is coined.

What is left is "should this table sort its encrypted columns the way the rest of the product sorts encrypted columns", which is not a decision that needs a sign-off gate. The marker is therefore removed and the spec is resolved autonomously, per the autonomous-run contract. **This is reversible and open to override**: a reviewer who wants a module-local ceiling tighter than the platform value can say so, and the change is one paragraph in API Contracts plus one implementation step. The PR remains a draft regardless, because a spec-only design PR is promoted by a human, not by automation.

## 📝 Problem Statement

`/backend/customer_accounts/users` is the only place staff manage customer portal accounts. Today the list is frozen in "newest first" order:

- `packages/core/src/modules/customer_accounts/api/admin/users.ts:156` — `orderBy: { createdAt: 'DESC' }` is a literal, and the route's query parsing (lines 40–46) reads `page`, `pageSize`, `status`, `customerEntityId`, `personEntityId`, `roleId`, `search` and nothing else.
- `packages/core/src/modules/customer_accounts/backend/customer_accounts/users/PortalUsersPageClient.tsx:538` — the `DataTable` receives `columns`, `data`, search, filters, perspective and pagination, but none of `sortable`, `manualSorting`, `sorting`, `onSortingChange`.

The practical cost: an operator looking for the least-recently-active accounts, or scanning alphabetically for a person whose exact spelling they do not know, has to page through the whole list. Every comparable list in the product already sorts — the CRM People and Companies lists (`packages/core/src/modules/customers/backend/customers/people/page.tsx:924-926`) do, as do the WMS, EUDR and query-index tables — so the absence here reads as a gap, not a decision.

## 📝 Proposed Solution

Wire the page into `DataTable`'s existing manual-sorting contract and teach the admin list route a `sortField` / `sortDir` pair, mirroring the naming the CRM lists already established (`packages/core/src/modules/customers/backend/customers/listSorting.ts`).

The non-obvious half is the encryption boundary. `packages/core/src/modules/customer_accounts/encryption.ts:6-9` declares `email` (with an `email_hash` blind index) and `display_name` as encrypted fields on `customer_accounts:customer_user`, and `isTenantDataEncryptionEnabled()` (`packages/shared/src/lib/encryption/toggles.ts`) **defaults to enabled** when `TENANT_DATA_ENCRYPTION` is unset. `findAndCountWithDecryption` passes `options` — including `orderBy` — straight through to `em.findAndCount` and only decrypts the rows the database already chose and ordered. So `ORDER BY display_name` sorts ciphertext: stable, deterministic, and meaningless to a human.

This is the same wall the route's own search already hit — it routes partial matches through `search_tokens` precisely because "ILIKE on the ciphertext never matches a plaintext search term" (comment at `users.ts:73-75`). Sorting has no token-table equivalent, because tokens are hashed and hashes do not preserve order.

**The platform already has the answer, and this spec uses it rather than restating it.** `@open-mercato/shared/lib/query/encrypted-sort` provides the cap (`resolveEncryptedSortMaxRows()`, `encrypted-sort.ts:32`), the encrypted-field resolution (`resolveEncryptedSortFields()`, `:41`) and the in-memory comparator (`sortRowsInMemory()`, `:85` — already locale-aware via `localeCompare` with `sensitivity: 'base', numeric: true`, and already applying an `id` tiebreak at `:95-97`). `mapWithConcurrency` from `@open-mercato/shared/lib/query/bounded-decrypt` bounds the decryption. Both query engines use them, and so do two routes that — like this one — go around the query engine entirely:

- `packages/core/src/modules/customers/api/labels/route.ts:86-110` sorts the encrypted `label` column off a direct `em.find`, capped by `resolveEncryptedSortMaxRows()`, decrypted through `mapWithConcurrency(..., DECRYPT_CONCURRENCY, ...)` with `DECRYPT_CONCURRENCY = 8` (`:38`), then ordered by `sortRowsInMemory`.
- `packages/core/src/modules/customers/api/interactions/encryptedSortPage.ts` does the same for a cursor-paged list.

Alternatives considered and rejected:

- **Persist a sortable plaintext (or order-preserving) column.** Storing a sort key derived from a name reintroduces exactly the plaintext the encryption map exists to remove, and order-preserving encryption leaks the distribution. It also needs a migration and a backfill. Rejected on security grounds; `packages/core/AGENTS.md` forbids hand-rolled crypto outright.
- **Client-side sort of the loaded page.** Free to build and actively misleading: with `pageSize: 50` and 300 users, "sort by name ascending" would sort 50 arbitrary rows and present them as the alphabetical top of the list.
- **Drop `Name`/`Email` from the sortable set.** Honest and cheap, but it fails the FR's explicit acceptance criterion ("a regression test should verify ascending and descending sorting for at least the `Name` and `Created` columns").
- **Build a module-local bounded decrypt-then-sort path** (the first draft of this spec). Rejected on review: it would have added a second cap env var that silently competes with `OM_ENCRYPTED_SORT_MAX_ROWS`, a second name for the already-documented degraded signal, and a second comparator to maintain. Reuse is strictly smaller and keeps one description of encrypted-sort capping in the product.

The chosen design keeps the cheap path cheap and pays the decryption cost only when a user actually asks to sort by an encrypted column, under the platform's existing ceiling and with the platform's existing warning when that ceiling bites.

## 📝 Architecture

Three units change; no module boundary is crossed and no new dependency is introduced.

**1. Sort-field resolver — `packages/core/src/modules/customer_accounts/backend/customer_accounts/users/listSorting.ts` (new, client-side).**

A pure module mirroring `customers/backend/customers/listSorting.ts`: maps a `DataTable` column id to the API's `sortField` token and appends `sortField`/`sortDir` to a `URLSearchParams`. Unmapped column ids return `null` and append nothing, so an injected or removed column can never produce a malformed request.

**2. Admin list route — `packages/core/src/modules/customer_accounts/api/admin/users.ts` (modified).**

Parses and validates `sortField`/`sortDir` with zod, then branches:

- **Plaintext branch** (`emailVerified`, `isActive`, `lastLoginAt`, `createdAt`): builds a MikroORM `orderBy` with the per-column null placement from Edge Cases and the `id` tiebreak, and keeps the existing single `findAndCountWithDecryption` call with `limit`/`offset`. One query, unchanged cost.
- **Encrypted branch** (`displayName`, `email`): composes the platform helpers in the `labels/route.ts:86-110` shape —

  1. `const cap = resolveEncryptedSortMaxRows()` — `null` means uncapped, exactly as everywhere else.
  2. Count the filtered set. **This is not an extra query**: the route must return `total` and `totalPages` for pagination anyway, so the count it already owes doubles as the cap comparison and as the `totalMatched` value on the warning.
  3. Load the candidate set with `findWithDecryption` under `{ limit: cap ?? undefined, orderBy: { id: 'asc' } }` — the deterministic candidate order matters so that a capped scan is reproducible rather than arbitrary.
  4. `await mapWithConcurrency(rows, DECRYPT_CONCURRENCY, ...)` with `DECRYPT_CONCURRENCY = 8`, the established bound at every existing call site (`labels/route.ts:38,100`, `interactions/encryptedSortPage.ts:5,20`, `query_index/lib/engine.ts:49`, `shared/lib/query/engine.ts:41`). Never a bare `Promise.all` over the candidate set.
  5. `sortRowsInMemory(rows, [{ field, dir }])` — the shared comparator, which supplies locale-aware ordering and the `id` tiebreak. No local comparator is written.
  6. Slice the requested page out of the sorted set.
  7. When `cap !== null && total > cap`, the scan was incomplete: emit `meta.encryptedSortRowCapWarning` on the response **and** log the structured warning below.

  Reused verbatim, this branch has no comparator, no tiebreak, no env parsing and no cap constant of its own.

**Observability on the degraded path.** When the cap bites, the route logs through the `createLogger` facade with the message and fields the existing call sites use, so the two are greppable together (`labels/route.ts:93`, `interactions/route.ts:509`):

```ts
logger.warn('Encrypted sort candidate scan hit OM_ENCRYPTED_SORT_MAX_ROWS cap; results may be incomplete', {
  component: 'customer_accounts.admin.users.GET',
  cap,
  tenantId,
  organizationId,
})
```

Without this, nobody can tell how often tenants hit the ceiling — which is precisely the data an operator needs to decide where to set the knob.

**3. List page client — `PortalUsersPageClient.tsx` (modified).**

Holds `sorting: SortingState`, feeds it into `queryParams` via the resolver, resets `page` to 1 whenever sorting changes, and passes `sortable` / `manualSorting` / `sorting` / `onSortingChange` to `DataTable`. Columns opt out individually with `enableSorting: false` (`roles`). When the response carries `meta.encryptedSortRowCapWarning`, the page surfaces a translated inline notice.

**Saved views come for free.** `DataTable.applyPerspectiveSettings` already restores `settings.sorting` and calls `onSortingChange?.(sortingState)` (`packages/ui/src/backend/DataTable.tsx:1893+`), and `perspectiveSettingsSchema` already persists a `sorting` array (`packages/core/src/modules/perspectives/data/validators.ts:12-15`). Once the page is a controlled sorting host, saving and applying a view carries sort with it. No perspectives change is in scope.

## 📝 Data Model

**No schema change. No migration. No new entity.** Every sortable value already exists on `CustomerUser`: `emailVerifiedAt`, `isActive`, `lastLoginAt`, `createdAt`, plus the encrypted `email` and `displayName`.

Sensitive-data handling is the load-bearing constraint rather than an afterthought:

- Decrypted names and emails exist only in request-scoped memory inside the encrypted branch, exactly as they already do for the rows of any listed page — the branch widens *how many* rows are decrypted per request, never *who* may see them or where they are persisted.
- Every query in both branches keeps the existing `tenantId` / `organizationId` / `deletedAt: null` scoping in `where`; the sort branch composes onto that `where`, it does not replace it.
- Nothing derived from a decrypted value is cached, logged, or written back. The degraded-path log carries the cap and the scope ids only — never a decrypted value.

## 📝 API Contracts

`GET /api/customer_accounts/admin/users` gains two optional query parameters. Both are additive; omitting them preserves the same fields, filters and page semantics as today (see the tiebreak note below for the one deliberate ordering change).

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `sortField` | `'displayName' \| 'email' \| 'emailVerified' \| 'isActive' \| 'lastLoginAt' \| 'createdAt'` | unset | Unrecognized values are **ignored**, not rejected |
| `sortDir` | `'asc' \| 'desc'` | `'desc'` | Only meaningful alongside a valid `sortField` |

Validated with zod alongside the existing schema and reflected in the route's `openApi.methods.GET.query` block so the generated API docs stay accurate.

**Invalid `sortField` is ignored rather than 400.** A saved perspective can outlive the column it references — a view saved before a column was renamed or removed would otherwise hard-fail the whole list page. Falling back to the default order degrades a stale view into a working list.

**The default ordering gains an `id DESC` tiebreak.** `{ createdAt: 'DESC' }` becomes `{ createdAt: 'DESC', id: 'DESC' }`. This observably reorders rows whose `createdAt` collides — which bulk-created users routinely do — so it is a deliberate ordering change on a STABLE surface rather than a no-op, and this spec does not claim byte-identity while making it. It is taken because the current ordering is non-deterministic across page boundaries, which can drop or duplicate a tied row between page 1 and page 2; a stable total order is strictly more correct than the ordering it replaces.

Response shape is unchanged except for one additive, optional field, adopting the platform's existing name and shape rather than coining a new one:

```jsonc
{
  "ok": true,
  "items": [ /* unchanged */ ],
  "total": 128,
  "totalPages": 3,
  "page": 1,
  "meta": {                              // present ONLY when the cap bit
    "encryptedSortRowCapWarning": {
      "entity": "customer_accounts:customer_user",
      "sortFields": ["displayName"],
      "maxRows": 5000,
      "totalMatched": 12043
    }
  }
}
```

`meta.encryptedSortRowCapWarning` is the documented platform signal for this exact condition (`apps/docs/docs/framework/database/hybrid-query-engine.mdx:62`; type `EncryptedSortRowCapWarning` at `packages/shared/src/lib/query/types.ts:150-158`; asserted at `packages/core/src/modules/query_index/__tests__/hybrid-engine.test.ts:1036`). Using it means a client that already renders "this ordering is incomplete" generically needs no special case for this route.

The `meta` envelope itself is new **on this route** — the handler builds its own JSON response and has no `meta` key today — but it is not a new concept in the product, and it is optional and absent on every existing code path, so no current consumer's parsing changes. Per `BACKWARD_COMPATIBILITY.md` this is an additive response field on a STABLE surface — permitted without a deprecation cycle.

**Configuration.** The encrypted branch is bounded by the existing platform knob **`OM_ENCRYPTED_SORT_MAX_ROWS`**. No new environment variable is introduced. Its semantics are the platform's, unchanged: unset or invalid means **uncapped** (`encrypted-sort.ts:28-38`), and the value is read only through `resolveEncryptedSortMaxRows()` — never a local `parseInt` and never a module-local default, so a single setting governs every encrypted sort in the deployment.

`OM_ENCRYPTED_SORT_MAX_ROWS` is currently documented only at `hybrid-query-engine.mdx:62` and is absent from `apps/mercato/.env.example`. This spec adds it to `.env.example` — which per the root Task Router obliges mirroring into the create-app template in the same change (`yarn template:sync:fix`) — and extends the docs line to name this route alongside the query engines, so the cap has one discoverable description covering every call site.

## 📝 UI/UX

Standard `DataTable` sorting chrome — clickable header, direction indicator, `aria-sort` — is supplied by the shared component and is not redesigned here. Only what is specific to this table:

- **Sortable:** Name, Email, Verified, Status, Last Login, Created.
- **Not sortable:** Roles (Q2) and the actions column. These render as plain headers with no click affordance, because `DataTable` only renders the sort button for columns where `getCanSort()` is true (`DataTable.tsx:3392`) — an unsortable column looks inert rather than broken.
- **Status sorts on the two-state `isActive` the cell renders.** The status *filter* beside it is tri-state — `active` / `inactive` / `locked` (`users.ts:55-62`) — and a locked account carries `isActive: true` with a future `lockedUntil`, so sorting by Status interleaves locked rows with active ones. That is deliberate and self-consistent with the rendered cell, which prints only Active/Inactive (`PortalUsersPageClient.tsx:456-470`); the tri-state locked distinction stays filter-only and is out of scope here. Called out because a reader comparing the sort to the filter would otherwise read it as a bug.
- **Changing sort returns to page 1.** Staying on page 7 of a freshly reordered list shows rows the user has no mental model for.
- **Degraded-sort notice.** When the response carries `meta.encryptedSortRowCapWarning`, the page shows a translated inline message under the table header explaining that alphabetical sorting covered only part of this list and suggesting narrowing with search or filters. It uses the existing status-token styling; no new component.
- **i18n.** The one new user-facing string is added to `customer_accounts` locale files under `customer_accounts.admin.sort.*` and read with `useT()` — never inlined.

Sorting composes with search, status/role filters, organization scope and pagination because all of them already flow through the same `queryParams` memo; sorting joins that memo rather than sitting beside it.

## 📝 Edge Cases & Failure Scenarios

### Null handling, per column

A blanket "nulls last in both directions" rule is wrong for `emailVerifiedAt`: null there means *unverified*, and sinking unverified accounts to the bottom in both directions makes the Verified column unsortable for the one reason an operator sorts it. Null placement is therefore per column, expressed with MikroORM's `QueryOrder` nulls variants (`ASC NULLS FIRST` / `DESC NULLS LAST`, and so on) rather than raw SQL:

| Column | Null placement | Why |
|--------|----------------|-----|
| `lastLoginAt` | **Nulls last in both directions** (`ASC NULLS LAST` / `DESC NULLS LAST`) | Null means "never signed in", which is neither the most nor the least recent login. Both "most recent" and "least recent" should open on real logins rather than a wall of dashes. |
| `emailVerifiedAt` (the `Verified` column) | **Nulls follow the direction** (`ASC NULLS FIRST` / `DESC NULLS LAST`) | Null means "unverified", a real value of the thing being sorted. Ascending therefore leads with the unverified group, descending leads with the most recently verified and trails with the unverified group — so either group can be brought to the top, which is the point of sorting this column. Ordering within the verified group falls out of the timestamp itself, so no secondary key is needed. |
| `isActive`, `createdAt` | n/a | Both are non-nullable. |
| `displayName`, `email` (encrypted branch) | **Missing values last ascending, first descending** | This is `sortRowsInMemory`'s own behavior, adopted as-is rather than fought: `compareValues` returns missing-last (`encrypted-sort.ts:71-75`) *before* the direction multiplier is applied (`:93`), so a descending sort places missing values first. Documented here rather than discovered during implementation, and asserted in the route tests so the coupling to the shared helper is visible. Pre-partitioning to force nulls-last in both directions is explicitly **not** done — it would fork the shared comparator's semantics for one table. |

### Other scenarios

| Scenario | Behavior |
|----------|----------|
| Encrypted sort over a filtered set larger than `OM_ENCRYPTED_SORT_MAX_ROWS` | The candidate scan is capped at `cap` rows in `id` order; the page is sorted from that subset, the response carries `meta.encryptedSortRowCapWarning` with the exact `totalMatched`, the UI explains it, and the route logs the structured warning. Never a timeout, never a silently incomplete order presented as complete. |
| `OM_ENCRYPTED_SORT_MAX_ROWS` unset (the default) | Uncapped, matching the platform default and the two existing call sites. The filtered set is decrypted at concurrency 8 and sorted in full. See Risks for the operator guidance this implies. |
| Encryption disabled (`TENANT_DATA_ENCRYPTION=false`) | The encrypted branch still runs and still sorts correctly — it sorts the values as decrypted, and with encryption off those are already plaintext. Correctness does not depend on the toggle; only cost does. |
| A row fails to decrypt | `decryptEntitiesWithFallbackScope` leaves the field as-is; `compareValues` coerces with `String(...)` and treats null/undefined as missing, so the sort stays total. One unreadable row cannot throw the list. |
| Ties on the sort key (same `createdAt`, same display name) | A secondary `id` ordering makes paging deterministic — supplied by the explicit tiebreak in the plaintext branch and by `sortRowsInMemory`'s built-in `id` tiebreak (`encrypted-sort.ts:95-97`) in the encrypted one. **This fixes a latent bug**: today `createdAt DESC` alone can drop or duplicate rows across page boundaries when timestamps collide. |
| `roleId` filter active (route pre-resolves matching ids into `where.id.$in`) | Unchanged. Sorting composes onto the already-narrowed `where` in both branches. |
| Search active with zero token matches | The existing early return still fires before any sort work — no wasted decryption. |
| A saved view references a column that no longer exists | `resolveCustomerUsersSortField` returns `null`, no sort param is sent, the list renders in default order. |
| Sorting requested by a user without `customer_accounts.view` | Unchanged — the RBAC check at the top of the handler runs before any query parsing. |

## 📝 Risks & Impact Review

**Blast radius: one API route, one page component, one new pure module.** No schema, no entity, no event, no DI key, no widget spot, no ACL feature, no new environment variable. Nothing outside `customer_accounts` reads the changed route.

- **Performance.** Sorting by Name or Email decrypts the filtered candidate set — bounded by `OM_ENCRYPTED_SORT_MAX_ROWS` when set, and by concurrency 8 through `mapWithConcurrency` always. On a tenant with a few hundred portal users this is negligible. The cost only materializes when an operator actively sorts an encrypted column, and filters and search shrink the set before the branch runs. **This is not a new risk profile**: it is the same bounded scan the product already performs for customer labels (`labels/route.ts`) and interactions, under the same knob — so an operator who has already tuned `OM_ENCRYPTED_SORT_MAX_ROWS` for those is covered here automatically, and one who has not is exposed here exactly as much as they already are there. Operators running very large tenants should set the variable; the degraded-path log tells them whether it is biting.
- **Backward compatibility.** Requests without `sortField` return the same fields, filters and page semantics as today, with the deliberate `id` tiebreak documented above. `meta` is additive and optional. No FROZEN or STABLE surface changes shape.
- **Rollback.** Purely reversible: reverting the three files restores current behavior with no data to migrate back. A partial mitigation is available without a deploy — lowering `OM_ENCRYPTED_SORT_MAX_ROWS` tightens the encrypted branch everywhere it runs, leaving the four plaintext columns untouched.
- **Security.** No new data is exposed to any caller: the encrypted branch decrypts rows the same authenticated, tenant-scoped principal is already entitled to list. The degraded-path log records the cap and scope ids only.

## 📋 Phasing

**Phase 1 — Server-side sorting contract.** The route accepts, validates and honors `sortField`/`sortDir` for all six columns, including the platform-bounded encrypted path. Independently shippable and independently valuable: API consumers get sorting even before the UI exposes it.

**Phase 2 — Table UI.** The page becomes a controlled sorting host, opts columns in and out, resets pagination, and surfaces the degraded-sort notice. Depends on Phase 1.

Each phase leaves the application working; Phase 1 merged alone is a no-op for the UI.

## 📋 Implementation Plan

### Phase 1 — Server-side sorting contract

1. **Add the sort-field allowlist and zod schema to `api/admin/users.ts`.** Define the `sortField` enum and `sortDir` enum, parse both from `url.searchParams`, and resolve invalid or absent values to "no sort". No behavior change yet — the parsed values are unused. *Test:* unit assertions that valid, invalid, and absent inputs resolve as specified.
2. **Add the deterministic tiebreak to the existing default ordering.** Change `orderBy: { createdAt: 'DESC' }` to `{ createdAt: 'DESC', id: 'DESC' }`. *Test:* existing route tests still pass; the assertion on the `orderBy` argument is updated to the new shape.
3. **Implement the plaintext sort branch.** Map `emailVerified → emailVerifiedAt`, `isActive`, `lastLoginAt`, `createdAt` onto a MikroORM `orderBy` using the per-column null placement from Edge Cases (`QueryOrder.ASC_NULLS_LAST` / `DESC_NULLS_LAST` for `lastLoginAt`; `ASC_NULLS_FIRST` / `DESC_NULLS_LAST` for `emailVerifiedAt`) plus the `id` tiebreak, passed into the existing `findAndCountWithDecryption` call. *Test:* route tests asserting the `orderBy` argument for each plaintext field in both directions, including the two distinct null placements.
4. **Implement the encrypted sort branch by composing the platform helpers.** For `displayName`/`email`, follow `customers/api/labels/route.ts:86-110`: `resolveEncryptedSortMaxRows()` for the cap, the count the route already computes for pagination as both the cap comparison and `totalMatched`, `findWithDecryption` with `{ limit: cap ?? undefined, orderBy: { id: 'asc' } }`, `mapWithConcurrency(rows, DECRYPT_CONCURRENCY, ...)` with `DECRYPT_CONCURRENCY = 8`, `sortRowsInMemory` for the ordering, then slice the page. **Write no comparator, no tiebreak, no cap parsing and no env var.** *Test:* route tests covering **Name ascending and descending** (the FR's mandated regression), email sorting, the over-cap path, and a row whose decryption left a non-string value — modeled on `packages/core/src/modules/customers/api/labels/__tests__/labels-encrypted-sort.test.ts`, which already asserts the capped and uncapped `em.find` shapes.
5. **Emit the degraded-path signal and log.** When `cap !== null && total > cap`, attach `meta.encryptedSortRowCapWarning` (`entity`, `sortFields`, `maxRows`, `totalMatched`) to the response and emit the `logger.warn` from Architecture unit 2 through `createLogger`, matching the existing message and fields verbatim so all three call sites are greppable together. *Test:* a route test asserting the warning is present with the exact `totalMatched` when the cap bites and absent when it does not, plus an assertion that the logger was called.
6. **Update the route's `openApi` GET query and response schemas** to document `sortField`, `sortDir` and the optional `meta.encryptedSortRowCapWarning`. *Test:* the API-docs generation check in the validation gate.
7. **Document `OM_ENCRYPTED_SORT_MAX_ROWS` in `apps/mercato/.env.example`** (it is currently missing there), mirror it into the create-app template with `yarn template:sync:fix`, and extend `apps/docs/docs/framework/database/hybrid-query-engine.mdx:62` to name this route alongside the query engines so the cap has one description covering every call site. *Test:* the template-sync check in the validation gate.

### Phase 2 — Table UI

8. **Add `backend/customer_accounts/users/listSorting.ts`** exporting `resolveCustomerUsersSortField(columnId)` and `appendCustomerUsersSortParams(params, sorting)`, modeled on the customers module's equivalent. *Test:* a unit suite mirroring `customers/backend/customers/__tests__/listSorting.test.ts` — mapped ids, unmapped ids, empty sorting state, direction mapping.
9. **Make `PortalUsersPageClient` a controlled sorting host.** Add `sorting` state, append the sort params inside the existing `queryParams` memo, reset `page` to 1 on sorting change, and pass `sortable`, `manualSorting`, `sorting`, `onSortingChange` to `DataTable`. Mark the `roles` column `enableSorting: false`. *Test:* a component test asserting the fetched URL carries `sortField`/`sortDir` after a header click and that the page resets to 1.
10. **Surface the degraded-sort notice.** Read `meta.encryptedSortRowCapWarning` from the response into state and render the translated inline message; add the string to the `customer_accounts` locale files. *Test:* component test for the notice appearing only when the warning is present; `yarn i18n:check-sync` / `yarn i18n:check-usage` in the gate.
11. **Add integration coverage** per `.ai/qa/AGENTS.md` — a self-contained test that creates its own customer users via the API, sorts by Name ascending and descending and by Created ascending and descending, asserts the returned order, and cleans up its fixtures in teardown.
