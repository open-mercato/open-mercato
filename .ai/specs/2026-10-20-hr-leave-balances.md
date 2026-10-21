# HR leave balances and accrual

**Status:** implemented (2026-10-20)
**Owner:** `apps/mercato/src/modules/hr_management`
**Milestone:** M2.4 of `.ai/plans/2026-10-19-saudi-erp-mvp-execution-plan.md`

## TLDR

Leave requests currently check only for date overlap. This change adds per-employee,
per-leave-type entitlements, an idempotent monthly accrual ledger, and a balance check on
leave create/update. Unpaid leave stays uncapped and continues to deduct through payroll.

## Problem

`HrLeaveRequest` records what an employee booked, but nothing records what the employee is
entitled to. Any employee can book unlimited annual or sick leave; HR only discovers the
overrun after the fact. Payroll already consumes approved `unpaid` leave and absences, so the
missing half is the paid-leave entitlement and its accrual.

## Proposed solution

1. **`HrLeaveEntitlement`** — the policy row for one employee, leave type and period
   (normally a calendar year): `entitled_days`, `carry_over_days`, optional notes. Unique per
   `(organization_id, tenant_id, employee_id, leave_type, period_start)` while not deleted.
2. **`HrLeaveAccrual`** — an append-only ledger of days added to an entitlement, keyed by
   `(organization_id, tenant_id, employee_id, leave_type, accrual_month)`. The unique key makes
   the monthly run idempotent: replaying a month inserts nothing twice.
3. **Balance** = `entitled_days + carry_over_days + accrued_days − approved_days − pending_days`
   for the entitlement period(s) overlapping the request.
4. **Enforcement** — `assertLeaveRequestBookable` refuses a paid request whose `totalDays`
   exceeds the available balance with `409 leave_balance_exceeded`. Requests without any
   entitlement row are allowed (no policy configured), and `unpaid` leave is never capped.
5. **Accrual run** — `POST /api/hr_management/leave-accruals/run` accrues
   `entitled_days / 12` (two decimals, half-up) per active employee for a requested month.
   `HrLeaveAccrual` rows record what was added, so a re-run is a no-op.

## Data models

### `hr_leave_entitlements` (`HrLeaveEntitlement`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id`, `organization_id` | uuid | required, scoped on every read/write |
| `employee_id` | uuid | id only, no ORM relation to `hr_employees` |
| `leave_type` | text | one of `LEAVE_TYPES` |
| `period_start`, `period_end` | date | inclusive; normally 1 Jan – 31 Dec |
| `entitled_days` | numeric(8,2) | default `0` |
| `carry_over_days` | numeric(8,2) | default `0` |
| `notes` | text | nullable |
| `created_by`, `created_at`, `updated_at`, `deleted_at` | | standard columns |

Indexes: tenant/org; employee/leave type/period; partial unique on
`(organization_id, tenant_id, employee_id, leave_type, period_start) WHERE deleted_at IS NULL`.

### `hr_leave_accruals` (`HrLeaveAccrual`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `organization_id` | uuid | |
| `employee_id` | uuid | |
| `leave_type` | text | |
| `accrual_month` | date | first day of the month |
| `days` | numeric(8,2) | days added |
| `entitlement_id` | uuid | nullable; the entitlement row credited |
| `source` | text | `monthly` \| `manual` |
| `note` | text | nullable |
| `created_by`, `created_at` | | append-only ledger; no update/delete API |

Indexes: tenant/org; employee/leave type/month; unique on
`(organization_id, tenant_id, employee_id, leave_type, accrual_month)`.

## API contracts

| Method | Path | Feature | Purpose |
|---|---|---|---|
| GET | `/api/hr_management/leave-entitlements` | `hr.read` | List/filter by `employeeId`, `leaveType`, `periodStart`/`periodEnd`, `id`/`ids` |
| POST | `/api/hr_management/leave-entitlements` | `hr.write` | Create an entitlement |
| PUT | `/api/hr_management/leave-entitlements` | `hr.write` | Update an entitlement (optimistic lock via `updatedAt`) |
| DELETE | `/api/hr_management/leave-entitlements` | `hr.write` | Soft-delete |
| GET | `/api/hr_management/leave-accruals` | `hr.read` | List accrual rows |
| POST | `/api/hr_management/leave-accruals/run` | `hr.write` | Accrue one month; body `{ month: 'YYYY-MM', employeeId?, leaveType? }` |

Every list response projects `updated_at` as `updatedAt`. The leave-request create and
update paths call the balance check; the check is skipped when the effective status is not
`pending`/`approved`, and when the leave type is `unpaid`.

## UI surface

- `backend/hr/leave-entitlements` — list with employee, leave type, period, entitled and carry-over
  columns; create/edit forms; delete through `CrudForm` (optimistic lock).
- A **Run accrual** action on the list opens a small dialog (month, optional employee/type)
  and calls the run endpoint, reporting how many rows were created.
- The leave request list/form continue to use the existing type field; the balance refusal is
  surfaced by the API as a 409. A read-only balance panel on the request form is a follow-up,
  not part of this slice.

## Risks and mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| Stored balance drifts from requests | High | `used_days`/`pending_days` are computed from `hr_leave_requests` on every check; only entitlement/accrual amounts are stored. |
| Replayed accrual job double-credits | High | Unique `(org, tenant, employee, leave_type, accrual_month)`; insert-on-conflict is a no-op. |
| Entitlement periods overlap or leave gaps | Medium | Balance sums overlapping entitlement rows; requests outside any entitlement are allowed rather than silently capped. |
| Paid/unpaid semantics drift between HR and payroll | Medium | Only `unpaid` is uncapped; payroll already filters `leaveType: 'unpaid'` for deductions. |
| Updating a request bypasses the check | High | `beforeUpdate` recomputes the effective values from the patch plus the stored row and excludes the request itself from usage. |

## Backward compatibility

Additive only: two new tables, one new API pair, new i18n keys. No existing column, route,
event id or ACL id changes. Leave requests without entitlement rows behave exactly as before.

## Test coverage

- Unit: `lib/__tests__/leaveBalances.test.ts` — pure balance arithmetic, exclusion of the
  request being edited, negative balances and monthly accrual rounding.
- Integration: `__integration__/TC-HR-008-leave-balances.spec.ts` — entitlement create, an
  over-balance request refused, pending leave consuming the balance, monthly accrual idempotent,
  unpaid leave accepted above the entitlement and deducted by payroll.

## Changelog

- 2026-10-20 — initial implementation: entitlement/accrual entities, balance check, accrual
  run, API, screens and tests.
