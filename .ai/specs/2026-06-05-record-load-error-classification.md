# Consistent record-load error classification (bad/invalid id → neutral not-found)

- Date: 2026-06-05
- Scope: OSS (`packages/ui`, detail/edit pages across `packages/core` + provider packages)
- Status: Draft (follow-up to #2127)
- Related: #2127 (`RecordNotFoundState` DS component) — this spec builds on it but is intentionally a separate PR.

## Problem

When a backend detail/edit page is opened with a **malformed or stale id** in the URL, the UX is
inconsistent and often poor:

- Strict pages (e.g. scheduler `/backend/config/scheduled-jobs/<bad>`) validate the id (route-level
  zod / `isUuid`) → the API returns `400 { error: 'Invalid input' }` → the page shows a bare, scary
  red `ErrorMessage` ("Error / Invalid input"). From the user's perspective the record simply does
  not exist; a 400 alarm is the wrong signal.
- CRUD-list pages using `?ids=<id>` go through `parseIdsParam`, which **silently drops** invalid
  UUIDs (`parseIdsParam('invalid') → []`). Depending on how the empty-ids filter is treated
  (match-none vs filter-skipped) the page may show a neutral not-found **or** an unrelated record —
  **needs audit**.
- Net result: the same user action ("open a bad/old URL") produces a red error on one page, a
  not-found on another, and possibly a wrong record on a third.

The id validation has **no single choke-point** — it is distributed across:
- `packages/shared/src/lib/crud/factory.ts:539` — `ZodError` → `400 'Invalid input'`
- `factory.ts` update path — `if (!isUuid(id)) return json({ error: 'Invalid id' }, { status: 400 })`
- per-route query schemas validating `id`/`ids`
- custom catch-all routes (scheduler, etc.)

## Goal

A malformed/missing id should land the user on the **neutral `RecordNotFoundState`** (from #2127),
not a destructive error — consistently across every record-backed detail/edit page. Genuine failures
(5xx / network) keep the red `ErrorMessage`; authorization failures keep `AccessDeniedMessage`.

## Design — client-side classification helper (NOT an API contract change)

Because the validation is distributed and changing API status codes (400 → 200/404) risks breaking
consumers and integration tests, classify on the **client** at load time.

Add a shared helper (e.g. `@open-mercato/ui/backend/detail`):

```ts
export type RecordLoadOutcome = 'notFound' | 'forbidden' | 'error'

/** Classify a thrown load error so detail pages pick the right page state. */
export function classifyRecordLoadError(err: unknown): RecordLoadOutcome {
  const status = extractHttpStatus(err) // reads status off CrudHttpError / apiCall errors
  if (status === 404) return 'notFound'
  if (status === 400) return 'notFound' // malformed id ⇒ "this record can't exist"
  if (status === 401 || status === 403) return 'forbidden'
  return 'error' // 5xx, network, unknown
}
```

Detail/edit pages then converge on:

```ts
catch (err) {
  const outcome = classifyRecordLoadError(err)
  if (outcome === 'notFound') setIsNotFound(true)
  else if (outcome === 'forbidden') setIsForbidden(true) // AccessDeniedMessage
  else setError(message)
}
```

Open option (optimization): pages whose id is always a UUID may **pre-validate** the route id and set
`isNotFound` without a network round-trip. Decide per-page; not required for correctness.

### Caveat to resolve during implementation
- Confirm `400` should map to `notFound` universally. A 400 from a *body/payload* validation on a
  mutation is different from a 400 on a *bad id GET*. The helper is for the **record-load (GET)** path
  only — do not route mutation/validation 400s through it.

## Scope

All record-backed detail/edit pages that already render `RecordNotFoundState` (the ~40 adopters from
#2127) plus any that still hand-roll load handling. Reference list: derive from
`grep -rl RecordNotFoundState --include=*.tsx packages apps` (backend pages). Notable strict-validation
page to fix first (the reported case): `packages/scheduler/.../config/scheduled-jobs/[id]/page.tsx`.

Also audit and fix the `?ids=` "drops invalid id" behavior so a dropped id yields **not-found**, never
the full list / a wrong record.

## Backward Compatibility

- **No API changes** — status codes and payloads stay as-is; classification is client-only.
- Pages keep the red `ErrorMessage` for genuine 5xx/network errors and `AccessDeniedMessage` for 401/403.
- Builds on #2127's `RecordNotFoundState`; no contract surface changes.

## Test / Integration Coverage

- **Unit:** `classifyRecordLoadError` — 404/400 → notFound, 401/403 → forbidden, 500/network → error;
  plus `extractHttpStatus` across `CrudHttpError` / `apiCall` error shapes.
- **Integration (key UI path):** open a detail page with a **malformed id** → assert the neutral
  not-found (title + back link, `role!="alert"`), NOT a red "Invalid input" box. Add for at least one
  strict-validation page (scheduler) and one CRUD-list page (customers companies).

## Validation

```bash
yarn build:packages && yarn typecheck && yarn lint
yarn workspace @open-mercato/ui test
# + the new malformed-id integration specs via the ephemeral runner
```

## Out of scope

- Changing API HTTP status codes for malformed ids (kept 400/404 — classification is client-side).
- The `RecordNotFoundState` component itself (delivered in #2127).
