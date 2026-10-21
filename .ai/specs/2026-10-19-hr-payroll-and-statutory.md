# HR payroll, compensation and Saudi statutory outputs

**Status:** Implemented (payroll + statutory calculators; loan/penalty/incentive APIs; payroll screen)
**Created:** 2026-10-19
**Supersedes implementation status of:** [`2026-09-26-hr-compensation-domain.md`](2026-09-26-hr-compensation-domain.md) (the design intent is kept; actual field types and surfaces are recorded here)
**Module:** `apps/mercato/src/modules/hr_management`

## TLDR

The money half of HR now exists: effective-dated compensation, employee loans with schedules, penalties, incentives, payroll runs, payslips with traceable lines, GOSI/end-of-service calculators and a WPS-style SIF export. A closed run emits `hr_management.payroll_run.closed`, and the financial module posts it to the ledger (payroll expense against net and deductions payable).

## Decisions

1. **Basic salary is effective-dated** (`HrEmployeeCompensation`), not a column on the employee. A pay raise in March must not rewrite January's payslip.
2. **Amounts are decimal strings** stored as `numeric(18,4)`, not integer minor units as the first draft proposed. This matches the ledger, reuses its exact BigInt arithmetic, and still avoids floats. The deviation is deliberate and documented.
3. **Deduction ceiling is a parameter, default 0 (disabled).** The legally correct share must be confirmed with local counsel; the payroll calculate action accepts `deductionCeilingShare` (0–1) and applies it to penalties and loan instalments only. Unpaid leave and absence are statutory and are not capped away.
4. **Overtime is a manual amount** in the calculation input for now; attendance-derived overtime needs hourly rates and is a later phase.
5. **Payroll output is the in-app payslip breakdown.** A printable statement is a follow-up; the line table is the audit artifact.
6. **A calculated run can be closed directly when no approval workflow is configured.** When one is configured, submit creates an approval request against `hr_payroll_run`, and the engine's final approval sets the run to `approved`; close then consumes it.
7. **WPS/SIF is a deterministic generic exporter**, not a certified bank format. It carries explicit header/detail/trailer records, and the response header says `unverified-bank-format`. A bank adapter remaps it.

## Data model

| Entity | Table | Notes |
|---|---|---|
| `HrEmployeeCompensation` | `hr_employee_compensations` | Effective-dated basic + housing/transport/other allowances, currency. |
| `HrEmployeeLoan` | `hr_employee_loans` | Principal, instalment count/amount, first due date, outstanding, status, approval link. |
| `HrLoanInstalment` | `hr_loan_instalments` | Monthly schedule; `scheduled → deducted` on close; source link from the payslip line. |
| `HrEmployeePenalty` | `hr_employee_penalties` | Deduction / written warning / suspension days; approval link. |
| `HrEmployeeIncentive` | `hr_employee_incentives` | Bonus / commission / allowance / overtime pay; approval link. |
| `HrPayrollRun` | `hr_payroll_runs` | Period, payment date, status, totals, approval link. |
| `HrPayslip` | `hr_payslips` | Per employee: gross/deduction/net, leave and absence days, status. |
| `HrPayslipLine` | `hr_payslip_lines` | Kind, code, label, amount, source entity type/id, sequence. |

`HrEmployee` gained nullable `bank_iban` for the SIF.

## Calculation

- Contract pay = basic + housing + transport + other.
- Daily rate = contract pay / 30 (exact decimal division, half-up at scale 6).
- Earnings: basic, each allowance, overtime, each approved incentive.
- Deductions: unpaid leave days × daily rate, absence days × daily rate, approved penalties, scheduled loan instalments due in the period.
- The deduction ceiling, when set, caps penalties and loan instalments; unpaid leave and absence remain.
- Net never goes below zero; if deductions exceed gross the deduction total is clamped to gross.
- Payslip lines carry the source row for every incentive, penalty and loan instalment, so "why is this lower?" is a query.

## Statutory

- **GOSI** (`/api/hr_management/statutory/gosi`): base = basic + housing, capped (default 45,000), employee 9.75%, employer 11.75% — all rates and the cap are configurable query parameters, with a note to confirm the current schedule.
- **End of service** (`/api/hr_management/statutory/eosb`): half a month per year for the first five years, one month per year after, scaled on resignation (<2 years 0, <5 ⅓, <10 ⅔, otherwise full). Factors are parameters.
- **WPS SIF** (`/api/hr_management/payroll-runs/[id]/sif`): header/detail/trailer, unformatted amounts, IBAN from the employee record; the concrete bank layout is not claimed.

## API

CRUD: `/api/hr_management/compensations`, `/penalties`, `/incentives`.
Read-only lists: `/loans`, `/payroll-runs`, `/payslips`; `/payslips/lines?id=`.
Actions: `POST /loans/{create,update,delete}`, `POST /payroll-runs/{create,update,delete,calculate,submit,close}`.
Statutory: `GET /statutory/{gosi,eosb}`, `GET /payroll-runs/[id]/sif`.

All action routes go through `runHrAction`, which applies the route mutation guard and the command bus, matching the approvals routes.

## Ledger integration

`financial/subscribers/hr-payroll-posting.ts` subscribes to `hr_management.payroll_run.closed`:

- debit payroll expense (account type `payroll`) with gross;
- credit net payable (type `payable`) with gross − deductions;
- credit payroll deductions payable (code `2160`, falling back to payable) with deductions.

The Saudi CoA gained `2160 Payroll deductions payable`. Idempotency is the posting source index (`hr_payroll_run` + run id).

## UI

`/backend/hr/payroll` — list, create, detail with Calculate / Submit / Close / Download SIF and the payslip breakdown. Loan, penalty and incentive CRUD is API-complete; dedicated screens are a follow-up (the payroll line detail already shows their source rows).

## Tests

- Unit: `lib/__tests__/payrollService.test.ts` — allowances, unpaid leave, absence, incentives/penalties/loans, ceiling, negative-net clamp, GOSI rates and cap, EOSB service and resignation scale, SIF records.
- Integration: `__integration__/TC-HR-007-payroll-round-trip.spec.ts` — employee + compensation → run → calculate → payslip totals → close → payroll entry posted with the expected two lines.

## Out of scope

- Per-employee payslip PDF/print output.
- Overtime computed from attendance (needs hourly rates).
- GOSI/EOSB statutory filing integrations (Mudad/Qiwa) and bank-certified SIF layouts.
- Employee self-service portal.
- Penalty deduction ceiling default confirmed by counsel.
