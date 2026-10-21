# HR compensation domain: loans, penalties, incentives, payroll

Status: **implemented** (2026-10-20) — phases A–D shipped via `2026-10-19-hr-payroll-and-statutory.md`;
leave entitlement/accrual balances shipped via `2026-10-20-hr-leave-balances.md`.
Scope owner: `apps/mercato/src/modules/hr_management` (all new tables live there).

## Problem statement

`hr_management` today covers the *record-keeping* half of HR: employees, departments,
leave requests, attendance, driver profiles, documents, and an approval engine that decides
requests against configurable workflows. The *money* half does not exist at all: there is no
way to record a salary advance, a disciplinary deduction, a bonus, or to run a payroll
period. That makes the module unusable for its stated purpose — a transport company paying
drivers and staff — because attendance and leave already produce inputs that have nowhere to
land financially.

The gap is structural, not cosmetic: it needs four new table groups. That is why this spec
exists before any entity is written. Four separate attempts at these tables would produce a
schema that cannot answer the questions payroll actually asks ("why is this payslip
different from last month?", "what is still owed on this loan?").

## What exists and must be reused, not rebuilt

| Capability | Where | How this domain uses it |
|---|---|---|
| Approval engine (submit / approve / reject / reassign / cancel) | `commands/approvals.ts`, `lib/approvalState.ts`, `api/approvals/*` | Every loan, penalty, incentive and payroll run is submitted for approval with its own `entityType`; the engine owns status transitions |
| Workflow + step definitions | `HrApprovalWorkflow`, `HrApprovalStepDefinition` | A payroll workflow can require two steps (HR then finance) with no new tables |
| Action log | `HrApprovalActionLog` | Audit trail for every decision, already written by the engine |
| Attendance | `HrAttendanceRecord` | Source of absence and lateness deductions |
| Leave | `HrLeaveRequest` | Paid vs unpaid leave decides whether a day deducts |
| Employees | `HrEmployee` | `employee_id` by id only (no cross-module ORM relation) |
| Money | `currencies` module | Currency by id plus a snapshot column, never a live join |

## Money and currency rules (apply to every table below)

- Amounts are **integer minor units** (halalas), never floats. A payroll error caused by
  binary floating point is unrecoverable in an audit.
- Every money-bearing row carries `currency_code` (snapshot) next to an optional
  `currency_id`, so a historical payslip stays readable if the tenant changes currency.
- No ORM relation to `currencies`: id plus snapshot columns only.

## 1. Loans and advances (السلف)

`HrEmployeeLoan`: `id`, `tenant_id`, `organization_id`, `employee_id`,
`principal_amount`, `currency_code`, `currency_id`, `instalment_count`,
`instalment_amount`, `first_due_on`, `outstanding_amount`, `reason`, `notes`,
`approval_request_id`, plus `status` (`pending` | `approved` | `rejected` | `cancelled` |
`settling` | `settled`).

`HrLoanInstalment`: `id`, `tenant_id`, `organization_id`, `loan_id`, `sequence`,
`due_on`, `amount`, `status` (`scheduled` | `deducted` | `skipped` | `written_off`),
`payroll_run_id`, `payslip_id`.

**Rules**

- The instalments sum to the principal *exactly*; the rounding remainder lands on the last

## 2. Penalties (الجزاءات)

`HrEmployeePenalty`: `id`, `tenant_id`, `organization_id`, `employee_id`,
`penalty_type` (`deduction` | `written_warning` | `suspension_days`), `incident_on`,
`amount` (null for a warning), `suspended_days` (null for the others), `reason`
(required), `status`, `approval_request_id`, `decided_by_user_id`, `decided_at`,
`payroll_run_id`, `payslip_id`.

**Rules**

- A penalty is never destructively applied at creation. It deducts only through a payslip
  line, so reversing one is a new row rather than an edit of history.
- The deduction ceiling is a tenant setting, defaulted conservatively as a share of the
  period gross and clamped server-side. The legally correct share must be confirmed with
  local counsel before a default ships (see Open questions).

## 3. Incentives (الحوافز)

`HrEmployeeIncentive`: `id`, `tenant_id`, `organization_id`, `employee_id`,
`incentive_type` (`bonus` | `commission` | `allowance` | `overtime_pay`), `amount`,
`currency_code`, `period_start`, `period_end` (nullable for a one-off award), `reason`,
`status`, `approval_request_id`, `payroll_run_id`, `payslip_id`.

**Rules**

- An incentive is paid exactly once. Marking it paid requires the payslip id and is
  idempotent: a second claim on the same row is refused rather than silently duplicated —
  a double-paid bonus is the failure mode this rule exists for.

## 4. Payroll (مسير الرواتب)

`HrPayrollRun`: `period_start`, `period_end`, `payment_date`, `status` (`draft` |
`calculated` | `submitted` | `approved` | `paid` | `closed`), `currency_code`,
`gross_total`, `deduction_total`, `net_total`, `employee_count`, `calculated_at`,
`approval_request_id`, `notes`.

`HrPayslip`: `payroll_run_id`, `employee_id`, `gross_amount`, `deduction_amount`,
`net_amount`, `status` (`draft` | `approved` | `paid`), `worked_days`, `paid_leave_days`,
`unpaid_leave_days`, `absence_days`, `notes`.

`HrPayslipLine`: `payslip_id`, `kind` (`earning` | `deduction`), `code` (`basic` |
`allowance` | `overtime` | `incentive` | `loan_instalment` | `penalty` | `unpaid_leave` |
`absence` | `manual`), `label`, `amount`, `source_entity_type`, `source_entity_id`,
`sequence`.

**Rules**

- A run and its payslips are computed in one transaction. A `calculated` run is recomputable
  (payslips are rebuilt); `submitted` and later are frozen, so an approval always refers to
  numbers that cannot move underneath it.
- Every deduction line points at the source row it consumed, which turns "why is this lower
  this month?" into a query instead of an investigation.
- Closing a run marks consumed instalments `deducted`, penalties and incentives `paid`, and
  a loan `settled` when its last instalment lands — all inside the run transaction, so a
  rollback cannot leave a penalty marked paid without the payslip that paid it.

## Approval integration

| Record | `entityType` | Effect on final approval |
|---|---|---|
| Loan | `hr_employee_loan` | `pending` → `approved`, the schedule becomes active |
| Penalty | `hr_employee_penalty` | `pending` → `approved`, eligible for deduction |
| Incentive | `hr_employee_incentive` | `pending` → `approved`, eligible for payment |
| Payroll run | `hr_payroll_run` | `submitted` → `approved` |
| Lateness permission | `hr_attendance_record` | `late` → `present`, with the decision comment as the reason |

Each is one branch in the engine's target-effect switch; no new workflow tables. The engine
already stamps `approval_request_id` on its target (added for leave requests) and that
behaviour generalises to these types.

## API surface

CRUD through `makeCrudRoute` with `hr.read` / `hr.write` as elsewhere, plus action routes
for the transitions that are not CRUD:

| Route | Purpose |
|---|---|
| `POST /api/hr_management/payroll-runs/calculate` | builds payslips and lines for a run |
| `POST /api/hr_management/payroll-runs/close` | consumes instalments, penalties and incentives; marks the run paid |
| `POST /api/hr_management/loans/{settle,cancel}` | early settlement and cancellation under the rules above |
| `POST /api/hr_management/approvals/*` | **already shipped**, reused unchanged |

Filters follow the existing convention (`employeeId`, `status`, period bounds) and every
list projects `updated_at` as `updatedAt` so the UI can drive optimistic locking.

## UI surface

Loans (list with outstanding balance and next instalment, form, instalments on the detail),
penalties, incentives, payroll runs (list with period, status and totals; detail with
payslips; calculate and close actions), and a read-only payslip breakdown showing the source
of every deduction. All reuse the pattern proven three times in this module already: a
`DataTable` component, a `CrudForm` component, six generated page files, and dictionary keys
in six locales with Arabic written by hand.

## Migration plan

1. Entities + validators, then `yarn db:generate` for **one** migration covering all five
   table groups. Per repo rules: review the emitted SQL, delete unrelated output, update the
   snapshot, and do not apply it locally without asking.
2. Commands + routes, then `yarn generate`.
3. `lib/payrollService.ts` with the arithmetic as pure functions (gross, deductions, net,
   instalment allocation) so it is unit-testable without a database.
4. Screens, then dictionary keys.
5. Integration tests: a loan instalment deducted in a payslip decreases the outstanding
   amount; a penalty deduction is clamped by the ceiling; an incentive is paid once; a
   `calculated` run recomputes and a `submitted` one refuses.

## Phasing (each phase ships on its own)

| Phase | Deliverable |
|---|---|
| A | Entities + validators + one migration |
| B | Commands, CRUD and action routes, payroll service with unit tests |
| C | Loans, penalties, incentives screens |
| D | Payroll runs and payslip screens |
| E | Portal "my payslips", reporting, exports |

## Open questions (answer before Phase A)

1. **Basic salary source**: a `basic_salary` column on `HrEmployee`, or an effective-dated
   `HrEmployeeCompensation` table? The second is correct for raises and history but costs a
   table and a join; the first cannot answer "what was his salary in March".
2. **Deduction ceiling**: what share of gross may a period's deductions reach, and is it per
   penalty or cumulative? Needs a defensible default, confirmed locally.
3. **Statutory contributions**: are end-of-service and social-insurance lines in scope for
   Phase A/B, or a later phase with their own rules tables?
4. **Overtime policy**: is `overtime_pay` an incentive typed in by hand, or computed from
   attendance? The latter needs hourly rates, which implies (1).
5. **Payslip output**: is the in-app breakdown enough, or is a printable statement required
   (which pulls the documents/attachments module into scope)?
6. **Payroll period locking**: does an approved run lock the attendance and leave it read, so
   later edits cannot silently invalidate numbers that have already been paid?

  one, so the schedule can never total more or less than what was borrowed.
- `outstanding_amount` decreases only when an instalment becomes `deducted`, in the same
  transaction that writes the payslip line. Two writers cannot both decrement it.
- Cancelling an approved loan is refused once any instalment has been deducted; the route
  out is an early settlement (remaining instalments `written_off`), which keeps the audit
  trail instead of rewriting it.
