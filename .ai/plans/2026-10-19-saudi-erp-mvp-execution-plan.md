# Saudi ERP MVP — prioritized execution plan

**Created:** 2026-10-19
**Status:** Ready to execute
**Inputs:** the module audits of `fleet_management`, `transport_operations`, `freight_operations`, `vehicle_rentals`, `student_transport`, `financial`, `saudi_localization`, `hr_management`, `customers` and `sales`; the existing plans in `.ai/plans/`; the financial and HR specs in `.ai/specs/`.
**Companions:** [`2026-09-26-app-modules-completion.md`](./2026-09-26-app-modules-completion.md), [`2026-09-26-fleet-hr-handoff.md`](./2026-09-26-fleet-hr-handoff.md), [`../specs/2026-10-09-financial-module-program.md`](../specs/2026-10-09-financial-module-program.md), [`../specs/2026-09-26-hr-compensation-domain.md`](../specs/2026-09-26-hr-compensation-domain.md).

## Where this plan starts

The fleet/transport vertical is the strongest pillar (~75 % of a workable MVP): vehicles, drivers, routes, trips, custody, freight contracts/abstracts/invoicing, rentals and school transport all have APIs, screens and tests. The gaps are depth (maintenance, fuel, insurance, violations, dashboards, portals) rather than foundations.

The three blockers to a sellable product are:

1. **Money does not reach the books.** Sales invoices and freight billing create sales documents, but nothing posts them to the general ledger. The GL is currently manual-entry plus `financial.payments.record`; the Saudi VAT return therefore only reconciles to postings an operator made by hand. AR and AP do not exist.
2. **HR cannot pay anyone.** Core HR and approvals are built, but payroll, GOSI, WPS/SIF and end-of-service do not exist, and the approval engine has authorization/integrity defects that must be fixed before it decides real requests.
3. **CRM is not Saudi-ready.** `customers` is a mature generic CRM (25 entities, 55 API routes, 170 Playwright specs), but it has no Arabic dictionary, no lead domain, no WhatsApp adapter and no deal→sales document link.

**Priority order:** trust → money → payroll → CRM → fleet depth → productization. The Arabic rollout and the CRM lead domain are safe to run in parallel with finance work because they touch disjoint files.

## Guiding rules

- Create or update a spec for every milestone before coding. New specs use `.ai/specs/{YYYY-MM-DD}-{kebab-case-title}.md`.
- Preserve behavior unless the spec explicitly changes it. Follow `BACKWARD_COMPATIBILITY.md` for every new column, route, event, ACL id or DI key.
- Never run `yarn db:migrate` without asking. Migrations and snapshots ship in the PR; the coding-agent exception for unrelated generator output applies.
- Every user-editable entity gets `updated_at`, returns `updatedAt`, and every mutating command enforces the optimistic lock.
- Every phase ships its integration tests in the same change, self-contained (create and delete fixtures).
- All new user-facing strings go through the six locale dictionaries; Arabic is authored, not machine-mirrored.
- No cross-module ORM relations. Use events, command bus, id + snapshot, or tolerant reads.
- Bump `yarn generate` after module structure changes. Never hand-edit generated files.

## Validation

Fast gate while iterating:

```bash
yarn generate
yarn typecheck
yarn lint
yarn test
yarn i18n:check-sync
yarn template:sync:fix
```

Full merge gate (ordered, from `.ai/agentic.config.json`):

```bash
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

Integration tests:

```bash
yarn test:integration
```

App-local fast typecheck for fleet/HR/transport:

```bash
cd apps/mercato
npx tsc -p .mercato/tsconfig-fleet.json
```

Run the full gate in Docker mode when a compose `app` container is running (`node scripts/docker-exec.mjs <command>`), otherwise locally; record the chosen runner in the PR.

## Priority summary

| Priority | Milestone | Why now | Rough effort |
|---|---|---|---|
| P0 | M0 — Trust and foundations | Security and integrity defects in modules already declared done; blocks any production pilot | 4–6 eng-days |
| P0 | M1 — Money loop | Invoicing exists but the ledger is disconnected; AR/AP are the difference between "billing tool" and "finance system" | 12–16 eng-days |
| P1 | M2 — Payroll and Saudi statutory | The transport company cannot pay drivers; payroll is the largest HR gap and the largest statutory gap | 15–20 eng-days |
| P1 | M3 — CRM Saudi readiness | Arabic CRM, leads, WhatsApp and deal→sales are the visible sales-team gaps; partly parallelizable | 12–16 eng-days |
| P2 | M4 — Fleet/operations depth | Maintenance, fuel, insurance, violations, portals and dashboards turn fleet from a register into an operating system | 15–20 eng-days |
| P2 | M5 — Productization | Packaging, template defaults, QA matrix, deployment and security review | 8–10 eng-days |

Estimates are rough engineer-days for one experienced developer, excluding review latency and external dependencies (ZATCA sandbox, bank SIF format, Mudad/Qiwa credentials).

---

## M0 — Trust and foundations (P0)

**Goal:** make the modules already declared complete safe to run with real data. **Exit criteria:** HR approvals are authorized per step and cannot be bypassed; HR uniqueness is DB-enforced; employee documents can hold files; the missing Saudi financial integration spec exists; the repo is clean.

### M0.1 HR approval authorization

**Problem:** `runDecision()` in `hr_management/commands/approvals.ts` never compares the actor with the step's configured approver. Any caller with `approvals.action` can decide any request at any step. `manager` steps cannot resolve because `HrEmployee` has no manager field. Reassignment only writes a comment marker.

**Files:**

- `.ai/specs/2026-10-19-hr-approval-authorization-and-integrity.md` (new spec)
- `apps/mercato/src/modules/hr_management/data/entities.ts` — add nullable `manager_employee_id` (UUID, self-reference within the module) or decide to resolve through `HrDepartment.managerEmployeeId`; document the choice in the spec.
- `apps/mercato/src/modules/hr_management/migrations/Migration20261019..._hr_approval.sql` + `.snapshot-open-mercato.json`
- `apps/mercato/src/modules/hr_management/commands/approvals.ts` — resolve the current step's approver (user / role / manager / reassigned override) and reject a non-approver with `403 approval_not_authorized`; advance the request and clear the reassignment override.
- `apps/mercato/src/modules/hr_management/lib/approvalAuthorization.ts` (new, pure where possible) + `lib/__tests__/approvalAuthorization.test.ts`
- `apps/mercato/src/modules/hr_management/__integration__/TC-HR-005-approval-authorization.spec.ts`

**Acceptance:** a non-approver is refused; a role-step approver with the role is accepted; a manager step resolves from the reporting line; the action log names the actual actor; reassignment changes who may decide; a stale `updatedAt` still returns 409.

### M0.2 Seal the approval-request CRUD

**Problem:** `/api/hr_management/approval-requests` exposes `POST/PUT/DELETE` with `hr.write`, and the schemas accept `status`, `currentStepOrder` and `decidedAt`. A caller can create an already-approved request or move a step without a log or target side effect.

**Files:**

- `apps/mercato/src/modules/hr_management/api/approval-requests/route.ts` — keep `GET`; remove public create/update/delete or gate them to an internal command/`hr.admin` with lifecycle fields stripped.
- `apps/mercato/src/modules/hr_management/data/validators.ts` — remove lifecycle fields from the public schemas; keep internal engine schemas if needed.
- `apps/mercato/src/modules/hr_management/commands/hr.ts` — adjust registration if the CRUD path is removed.
- Extend `TC-HR-005` or add `TC-HR-006-approval-crud-cannot-bypass.spec.ts`.

**Acceptance:** the only writes that change `status`/`currentStepOrder` are the five engine commands; a direct PUT is refused or ignored.

### M0.3 Enforce HR unique indexes

**Problem:** the entities declare partial unique indexes for employee number, national ID, department code, driver-per-employee and attendance-per-day, but the migration emits plain `create index`; the snapshot records `"unique": false`. This is the defect class recorded in `.ai/lessons/partial-unique-indexes-need-the-expression-form.md`.

**Files:**

- `apps/mercato/src/modules/hr_management/migrations/Migration20261019..._hr_unique_indexes.ts` (new)
- `apps/mercato/src/modules/hr_management/migrations/.snapshot-open-mercato.json`
- `apps/mercato/src/modules/hr_management/lib/hrService.ts` — keep the friendly pre-check and map the DB violation to a domain 409.
- `apps/mercato/src/modules/hr_management/__integration__/TC-HR-006-hr-uniqueness.spec.ts` (or extend `TC-HR-002`).

**Acceptance:** duplicate employee number, national ID, department code, driver profile and same-day attendance are rejected, including concurrent inserts.

### M0.4 Employee document upload

**Problem:** `file_attachment_id` is stored but never set by the UI; there is no detail page or upload control. The register cannot hold the documents an inspection asks for.

**Files:**

- `apps/mercato/src/modules/hr_management/components/EmployeeDocumentForm.tsx`
- `apps/mercato/src/modules/hr_management/components/EmployeeDocumentsTable.tsx`
- `apps/mercato/src/modules/hr_management/backend/hr/documents/[id]/page.tsx` + `page.meta.ts` (new detail/download surface)
- `apps/mercato/src/modules/hr_management/api/employee-documents/route.ts` — persist the attachment id and enforce scope on download.
- `apps/mercato/src/modules/hr_management/i18n/*.json` — upload/download/error keys.

**Acceptance:** attach a PDF to a document, download it, and confirm another tenant cannot.

### M0.5 Financial migration and missing Saudi integration coverage

**Files/actions:**

- Verify the state of the two financial migrations (`Migration20261009184139`, `Migration20261010142309`). If not applied, ask before running `yarn db:migrate`.
- Add `apps/mercato/src/modules/saudi_localization/__integration__/TC-SL-FIN-001-saudi-financial-plugin.spec.ts` covering cases 1–3 and 5 from the plugin spec (CoA seeding idempotency, a posted VAT line, the VAT return reconciling to the ledger, preview parity). Cases 4 and 6 land with M1.4.
- Add the missing trial-balance screen only if it is needed for the pilot; the API exists.

### M0.6 Repo hygiene

- Commit `packages/core/src/helpers/integration/moduleFixtures.ts` (the transport fixture re-export) with the next slice.
- Decide the create-app template policy: `scripts/template-sync.ts` disables `financial`, `fleet_management`, `hr_management`, `transport_operations`, `freight_operations` and `saudi_localization`, while `vehicle_rentals` and `student_transport` stay enabled. Align the list with the intended scaffold set. This is a packaging decision — ask first.

### M0.7 Decide fleet master-data ownership (decision gate, no code)

Write `.ai/specs/2026-10-19-fleet-master-data-ownership.md` choosing `transport_operations` as the single vehicle/driver register. `fleet_management` currently owns `fleet_vehicles`/assignments while `transport_operations` owns `transport_vehicles`/`transport_drivers`, and HR owns `HrDriverProfile`. Freight, rentals and school transport already read `transport_*`. Recommendation: `transport_operations` is the source of truth; `fleet_management` keeps assignments/documents/odometer and references `transport_vehicles`; HR keeps employment data and references the transport driver. The migration/backfill executes in M4.1.

---

## M1 — Money loop (P0)

**Goal:** every sales invoice, freight abstract and payment reaches the GL automatically; AR and AP exist; ZATCA Phase 2 can issue. **Exit criteria:** the VAT return is built from postings the system made, not the operator; AR/AP aging reconciles to the ledger; a Saudi standard invoice can be signed and submitted to the sandbox.

### M1.1 Sales/freight → GL posting

**Design:**

- Posting is driven by persistent subscribers on `sales.invoice.created|updated|deleted` and `sales.payment.created|updated|deleted`; freight invoices go through the same sales documents, so one bridge covers both.
- The financial module owns the subscriber and the mapping. It never imports sales entities: read `sales_invoices`, `sales_invoice_lines`, `sales_orders` with scoped Kysely queries (the tolerant-read pattern `freight_operations/lib/salesBridge.ts` already uses) or resolve a sales service behind `tryResolve`; a missing sales module degrades to a logged no-op.
- Account mapping is tenant config in `module_configs` (module `financial`, key `posting`): `accountsReceivableCode`, `salesRevenueCode`, `outputVatCode`, `cashAccountCode`/`bankAccountCode`. The Saudi CoA seeds the codes the tax catalogue already names (`2100` output VAT, `1150` input VAT, `2110` WHT payable).
- Posting is idempotent: add nullable `source_entity_type`, `source_entity_id` and a partial unique index on `(organization_id, tenant_id, source_entity_type, source_entity_id, entry_type)` to `gl_journal_entries`. A replay updates or no-ops, never doubles.
- Entry shape: AR debit `grand_total_gross`; revenue credit per line `total_net_amount`; output VAT credit `tax_total_amount`. A payment posts cash/bank debit and AR credit. A return or credit memo posts a reversing entry linked to the original.

**Files:**

- `.ai/specs/2026-10-19-financial-sales-posting.md` (new)
- `apps/mercato/src/modules/financial/commands/posting.ts` (new; `financial.sales_invoice.post`, `financial.sales_payment.post`, `financial.sales_document.reverse`)
- `apps/mercato/src/modules/financial/lib/postingMap.ts` (new; pure account/code resolution)
- `apps/mercato/src/modules/financial/subscribers/salesDocumentPosting.ts` (new)
- `apps/mercato/src/modules/financial/data/entities.ts` — source columns + index
- `apps/mercato/src/modules/financial/migrations/Migration20261019..._financial_posting.ts` + snapshot
- `apps/mercato/src/modules/financial/data/validators.ts` — posting settings schema
- `apps/mercato/src/modules/financial/backend/financial/settings/page.tsx` + components — account mapping screen (or extend the existing setup flow)
- `apps/mercato/src/modules/financial/i18n/*.json`
- `apps/mercato/src/modules/financial/__integration__/TC-FINANCIAL-003-sales-posting.spec.ts`
- Unit: `apps/mercato/src/modules/financial/lib/__tests__/postingMap.test.ts`

**Acceptance:** a sales invoice posts once and balances; a replayed event does not double-post; a payment posts; a return reverses; the Saudi VAT return's output VAT equals the output-VAT account movement with `reconciliationDelta = 0`.

**Open decision:** whether to post per line with tax codes or one output-VAT line per invoice. Start with one line per invoice (the ZATCA preview derives categories deterministically); refine when multi-category invoices are common.

### M1.2 Accounts receivable

**Files:**

- `.ai/specs/2026-10-19-financial-phase-3-accounts-receivable.md` (new)
- `apps/mercato/src/modules/financial/lib/arService.ts` (new; aging and statement read models over posted AR lines + sales invoices)
- `apps/mercato/src/modules/financial/api/ar/aging/route.ts`, `api/ar/statements/route.ts` (new)
- `apps/mercato/src/modules/financial/backend/financial/receivables/page.tsx`, `.../receivables/statements/[customerId]/page.tsx` (new)
- `apps/mercato/src/modules/financial/i18n/*.json`
- `apps/mercato/src/modules/financial/__integration__/TC-FINANCIAL-004-ar-aging.spec.ts`

**Acceptance:** aging buckets (0–30/31–60/61–90/90+) reconcile to the AR account; a customer statement lists invoices, receipts and outstanding; range filters are column names.

### M1.3 Accounts payable + withholding tax

**Entities:** `ApVendor`, `ApVendorInvoice`, `ApVendorInvoiceLine`, `ApPayment`, `ApPaymentAllocation` (`ap_*` tables), all tenant/org scoped, `updated_at`, soft delete.

**Files:**

- `.ai/specs/2026-10-19-financial-phase-2-accounts-payable.md` (new)
- `apps/mercato/src/modules/financial/data/entities.ts` + validators + migration + snapshot
- `apps/mercato/src/modules/financial/commands/ap.ts` (new; create/post/void invoice, record payment, allocate)
- `apps/mercato/src/modules/financial/api/ap/{vendors,invoices,payments}` routes
- `apps/mercato/src/modules/financial/backend/financial/payables/**` screens
- `apps/mercato/src/modules/financial/lib/registries.ts` — add an optional `withholding` capability to `FinancialCountryPlugin` (additive; generic returns `null`); implement it in `saudi_localization/financial-plugin.ts` over `lib/saudi/withholding.ts`.
- `apps/mercato/src/modules/financial/__integration__/TC-FINANCIAL-005-ap-and-wht.spec.ts`

**Acceptance:** a vendor invoice posts (expense/input VAT/AP); a payment deducts WHT and posts WHT payable; AP aging reconciles; the Saudi WHT categories come from the plugin, not the engine.

### M1.4 ZATCA Phase 2 issuance

**Files:**

- Update `.ai/specs/2026-10-09-financial-saudi-plugin.md` with the issuance design.
- `apps/mercato/src/modules/saudi_localization/data/entities.ts` — `SaudiEinvoiceSubmission` (`saudi_einvoice_submissions`)
- `apps/mercato/src/modules/saudi_localization/migrations/Migration202610..._saudi_einvoice_submissions.ts` + snapshot
- `apps/mercato/src/modules/saudi_localization/lib/zatca/issuance.ts` (new; persist XML/hash/ICV, commit the chain)
- `apps/mercato/src/modules/saudi_localization/lib/zatca/xades.ts` (new; signing behind config)
- `apps/mercato/src/modules/saudi_localization/api/zatca/issue/route.ts`, `api/zatca/submissions/route.ts`
- `apps/mercato/src/modules/saudi_localization/backend/saudi/submissions/page.tsx` + `page.meta.ts`
- Integration cases 4 and 6 in `TC-SL-FIN-001`.
- External gate: CSID onboarding and sandbox credentials. Nothing claims clearance until a sandbox submission is accepted.

**Acceptance:** issuing persists the XML/hash/ICV, advances the chain only on commit, records `pending`/`submitted`/`cleared`/`rejected`, and parity with the preview endpoint holds.

### M1.5 Bank reconciliation (P2, may slip to M4)

CSV statement import, matching against `gl_cash_accounts` and posted payments, reconciliation record and screen. Spec: `.ai/specs/2026-10-19-financial-phase-4-bank-reconciliation.md`.

### M1.6 Multi-currency (P2)

FX rate table, translation on posting (`base_debit_amount`/`base_credit_amount` currently copy the transaction amount), revaluation. Spec: `.ai/specs/2026-10-19-financial-phase-5-multi-currency.md`. Defer unless foreign vendors/customers are in the pilot.

---

## M2 — Payroll and Saudi statutory (P1)

**Goal:** HR can compute, approve, pay and post payroll, and the statutory outputs a Saudi employer needs exist. **Exit criteria:** a payroll run produces payslips whose lines trace to source rows, posts to the GL, and exports GOSI/WPS/EOSB data.

### M2.1 Answer the compensation-spec open questions (decision gate)

Before any table, settle the six questions in `.ai/specs/2026-09-26-hr-compensation-domain.md`:

1. Basic salary source — recommend effective-dated `HrEmployeeCompensation`, not a column on the employee.
2. Deduction ceiling — tenant setting; the default requires local-counsel confirmation. Do not ship a guessed legal default.
3. Statutory contributions — GOSI and end-of-service in M2.2; Mudad/Qiwa later.
4. Overtime — manual entry first, computed from attendance later.
5. Payslip output — in-app breakdown plus a printable HTML/PDF.
6. Period locking — a submitted run freezes attendance/leave inputs.

### M2.2 Compensation entities and payroll engine

**Entities:** `HrEmployeeCompensation`, `HrEmployeeLoan`, `HrLoanInstalment`, `HrEmployeePenalty`, `HrEmployeeIncentive`, `HrPayrollRun`, `HrPayslip`, `HrPayslipLine`. Integer minor units (halalas), `currency_code` snapshot, no ORM relation to `currencies`.

**Files:**

- `apps/mercato/src/modules/hr_management/data/entities.ts` + `data/validators.ts` + one migration + snapshot
- `apps/mercato/src/modules/hr_management/lib/payrollService.ts` (pure arithmetic) + `lib/__tests__/payrollService.test.ts`
- `apps/mercato/src/modules/hr_management/commands/compensation.ts`, `commands/payroll.ts`
- `apps/mercato/src/modules/hr_management/api/{loans,penalties,incentives,payroll-runs}` routes
- `apps/mercato/src/modules/hr_management/backend/hr/{loans,penalties,incentives,payroll-runs,payslips}/**`
- `apps/mercato/src/modules/hr_management/events.ts` — `hr.payroll_run.calculated|submitted|approved|paid|closed`
- `apps/mercato/src/modules/hr_management/i18n/*.json`
- Integration: `TC-HR-007-payroll-round-trip.spec.ts` (loan instalment deducted, penalty clamp, incentive paid once, calculated run recomputes, submitted run freezes).

**Approval integration:** each money record submits through the existing engine with `entityType` `hr_employee_loan`, `hr_employee_penalty`, `hr_employee_incentive`, `hr_payroll_run`; the final-approval target effect flips the record. This requires extending `lib/approvalTargets.ts` and the engine's target switch.

**GL integration:** financial subscribes to `hr.payroll_run.closed` and posts salaries expense / deductions payable / net payable, with the run id as the idempotency source (M1.1's source columns). HR never imports financial.

### M2.3 Saudi statutory calculators

**Files:**

- `apps/mercato/src/modules/hr_management/lib/statutory/gosi.ts` (configurable rates, Saudi/expats, employer/employee split)
- `apps/mercato/src/modules/hr_management/lib/statutory/wps.ts` (SIF exporter, configurable bank format)
- `apps/mercato/src/modules/hr_management/lib/statutory/eosb.ts` (end-of-service award; resignation vs termination, configurable)
- `apps/mercato/src/modules/hr_management/lib/statutory/__tests__/*.test.ts`
- `apps/mercato/src/modules/hr_management/api/payroll-runs/[id]/sif/route.ts`
- `apps/mercato/src/modules/hr_management/api/employees/[id]/eosb/route.ts`
- `apps/mercato/src/modules/hr_management/backend/hr/payroll-runs/[id]/page.tsx` — download SIF, show GOSI/EOSB totals
- Tenant settings screen for rates and formats.

**Rule:** every statutory rate and rule is tenant-configurable and ships with tests built from worked examples; a legal default is confirmed with counsel before it becomes the seed. GOSI/WPS/EOSB outputs are data files until a bank/Mudad sandbox accepts them.

### M2.4 Leave balances and attendance inputs

**Files:**

- `apps/mercato/src/modules/hr_management/data/entities.ts` — `HrLeaveType`, `HrLeaveEntitlement` (or balance columns), accrual records
- `apps/mercato/src/modules/hr_management/lib/hrService.ts` — `assertLeaveRequestBookable` checks the balance
- `apps/mercato/src/modules/hr_management/commands/leaveAccrual.ts` (worker or setup/period job)
- Integration: over-balance leave refused; unpaid leave produces a payslip deduction line.

### M2.5 Employee self-service (P2)

Portal pages for "my payslips", "my leave", "my attendance". Decide the identity model first: `customer_accounts` is customer identity; staff auth lives in `auth`. Do not reuse the customer portal for staff without an explicit decision.

### M2.6 Mudad / Qiwa (P3)

Adapter packages once API access and credentials exist. Out of the MVP critical path.

---

## M3 — CRM Saudi readiness (P1)

**Goal:** a Saudi sales team can work in Arabic, capture and convert leads, converse on WhatsApp, and trace a deal to the quote/order it produced. **Exit criteria:** Arabic CRM screens; lead → deal lineage; WhatsApp inbound/outbound; `deal_id` on sales documents.

### M3.1 Arabic dictionaries for `customers`, `sales`, `staff`

Use the existing rollout process (`apps/mercato/.mercato/ar-audit/BRIEF.md` + `verify.mjs`). The modules ship 2 880 keys each in en/de/es/ko/pl; `customers` has no `ar.json`, and the app dictionary translates only 63 `customers.*` keys.

**Files:**

- `packages/core/src/modules/customers/i18n/ar.json` (new, full key/order parity)
- `packages/core/src/modules/sales/i18n/ar.json` (new)
- `packages/core/src/modules/staff/i18n/ar.json` (new)
- App-level overrides in `apps/mercato/src/i18n/ar.json` only where a key intentionally differs.
- Seed dictionaries: translate CRM dictionary defaults (deal statuses, sources, activity types) at setup time or through the dictionary admin.
- Acceptance: `verify.mjs keys=<n> OK`, `yarn i18n:check-sync`, Arabic spot-check of people, companies, deals, pipeline and calendar.

### M3.2 Lead domain

Implement the existing `.ai/specs/2026-04-03-customers-lead-funnel.md` rather than inventing a new model.

**Files:** `customers/data/entities.ts` (`CustomerLead`, lead pipeline/stages), migration + snapshot, `customers/commands/leads.ts`, `customers/api/leads/**`, `customers/backend/customers/leads/**`, conversion command with lineage to person/company + deal, duplicate detection, dashboard widget, i18n, integration (`TC-CRM-LEAD-001`).

**Acceptance:** capture → qualify → convert; the converted deal links back to the lead; duplicates are flagged; lead pipeline kanban works.

### M3.3 WhatsApp channel package

**Files:**

- `packages/channel-whatsapp/package.json`, `src/index.ts`, adapter implementing the `communication_channels` contract, webhook verification, outbound send, media, template messages, tenant-scoped credentials.
- `apps/mercato/src/modules.ts` — register the package when enabled.
- CRM subscriber already links channel messages to interactions; verify and extend for WhatsApp.
- Tests: adapter unit tests, webhook route test, integration `TC-CRM-WA-001`.

**Acceptance:** inbound WhatsApp messages create a CRM interaction on the linked person; replies send from the CRM thread; credentials are per tenant; reauth/failure is visible in the channel admin.

### M3.4 Deal ↔ sales document link

**Files:**

- `packages/core/src/modules/sales/data/entities.ts` — nullable `deal_id` on quotes/orders/invoices (additive) + migration + snapshot.
- `packages/core/src/modules/sales/commands/**` — accept and propagate `dealId`; API responses expose it.
- `packages/core/src/modules/customers/widgets/injection/**` — Quotes/Orders tab on the deal detail, fed by sales list APIs filtered by `deal_id`.
- `packages/core/src/modules/customers/backend/customers/deals/[id]/page.tsx` — create-quote/create-order actions.
- i18n (all six locales; Arabic included).
- Integration: creating a quote/order from a deal stamps `deal_id`; the tab lists it.

**Constraint:** id only, no ORM relation; the widget reads sales through its API.

### M3.5 Telephony → CRM timeline

**Files:**

- `packages/core/src/modules/phone_calls/events.ts` — `phone_calls.call.completed`
- `packages/core/src/modules/customers/subscribers/phoneCallInteraction.ts` — create/dedupe a `CustomerInteraction` of type call on the linked person/company, with recording/transcript links.
- Tests: subscriber unit + integration.

### M3.6 Portal pages for CRM/sales (P2)

Deal/order/invoice pages under `frontend/[orgSlug]/portal/...` with `page.meta.ts` guards; reuse `customer_accounts` RBAC. Defer if the pilot does not need self-service.

---

## M4 — Fleet/operations depth (P2)

**Goal:** fleet becomes an operating system, not a register; the customer portal closes the freight approval loop; every priced service can be invoiced. **Exit criteria:** one vehicle register; maintenance/fuel/insurance/violations tracked; dashboards live; rentals and school transport invoice through sales.

### M4.1 Execute the master-data decision

Migrate `fleet_management` vehicles/assignments onto the `transport_operations` register (decision from M0.7): backfill, point assignment/document/odometer rows at `transport_vehicles`, keep `fleet_management` screens working through the new reference, and delete the duplicate register only after a verified backfill. Update freight/rentals/student reference pickers. This is the highest-risk item in M4; ship it alone, with a rollback plan and data verification queries.

### M4.2 Maintenance and work orders

New module `fleet_maintenance` (or a clearly separated slice of `fleet_management`): `MaintenanceSchedule`, `WorkOrder`, `WorkOrderPart`, `WorkOrderLabor`. Preventive schedules by odometer/date; completing a work order records cost, odometer and downtime; cost posts to GL through a financial subscriber. Screens: dashboard, schedules, work orders, parts.

### M4.3 Fuel, insurance, violations

`FuelLog`, `InsurancePolicy`, `TrafficViolation` entities; expiry/alert rules; fuel efficiency per vehicle; insurance cost posting; violation assignment to driver with an optional payroll-deduction link. Saudi-specific violation integration (Muroor) is an adapter later.

### M4.4 Close the operational loops

- Fleet and transport dashboard pages over the existing `dashboard-summary` APIs.
- Trip `cancel` command/route (the status exists but is unreachable).
- Freight customer-portal `respond`/`approve` routes and portal pages; remove the staff-only pin in `api/abstracts/respond/route.ts`.
- Rental and school-transport invoicing via the sales bridge (copy `freight_operations/lib/salesBridge.ts`; same compensate-on-failure and resync rules).
- Fleet custody approval wiring to the HR engine (the reserved `approvalRequestId`).

### M4.5 Telematics adapter (P3)

Provider-agnostic `TelematicsProvider` contract, webhook ingestion with SSRF protection, trip actuals and odometer reconciliation. Defer until a provider is chosen.

---

## M5 — Productization and hardening (P2)

### M5.1 Module packaging decision

Decide whether `financial`, `fleet_management`, `freight_operations` and peers stay app-local or move to packages. The financial program spec already designs the move as a relocation, not a rewrite. Do not move before the MVP is stable.

### M5.2 Template defaults

Align `scripts/template-sync.ts` with the intended scaffold set. Add Saudi defaults for a new tenant: Saudi CoA seed, VAT settings, payment methods, approval workflows, numbering sequences. `yarn template:sync:fix` must be clean.

### M5.3 QA matrix and deployment

- Every milestone's integration specs green in CI; a Playwright smoke for the pilot flows (invoice → GL → VAT return; hire → payroll → payslip; lead → deal → quote; vehicle → trip → freight abstract → invoice → portal approval).
- Deployment per the Railway spec; backups, error reporting, logging and health checks.
- Run `/security-review` over the diff before the pilot.

### M5.4 Pilot readiness checklist

- Migrations applied and snapshots reviewed.
- Default role ACLs synced (`yarn mercato auth sync-role-acls`) and portal ACLs (`yarn mercato customer_accounts sync-customer-role-acls`).
- Arabic audit green for every enabled module.
- Backup and restore exercised once.
- Data import plan for customers, vehicles, employees and opening balances.

---

## Dependencies and decision gates

| Gate | Decision | Blocks |
|---|---|---|
| G1 | Approve HR approval authorization design (manager field vs department manager; reassignment semantics) | M0.1, M2 |
| G2 | Approve removing public lifecycle writes on approval requests | M0.2 |
| G3 | Confirm whether the financial migrations are applied; authorize `yarn db:migrate` if not | M0.5, M1 |
| G4 | Choose sales-invoice posting granularity (one VAT line vs per line) | M1.1 |
| G5 | Confirm GOSI/EOSB rates and deduction ceiling with local counsel | M2.3 |
| G6 | Decide effective-dated compensation vs `basic_salary` column | M2.2 |
| G7 | Approve fleet master-data ownership (`transport_operations`) | M4.1 |
| G8 | Obtain ZATCA CSID/sandbox credentials | M1.4 |
| G9 | Obtain bank WPS/SIF format and Mudad/Qiwa API access | M2.3, M2.6 |
| G10 | Decide template scaffold policy | M0.6, M5.2 |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Posting bridge double-posts or misses a document | High | Source columns + partial unique index; persistent subscriber; replay test; reconciliation delta on the VAT return |
| Cross-module read of sales tables drifts with schema changes | Medium | One read-model module with a contract test; tolerant on missing tables; never import sales entities |
| Payroll legal defaults are wrong | High | Tenant-configurable rates; test vectors from counsel; no live claim until confirmed |
| Attribution of approvals remains ambiguous after reassignment | High | Explicit effective-approver resolution in the engine; audit log records the actor and target |
| Master-data migration loses vehicle history | High | Dedicated migration slice, backfill verification, rollback plan, no simultaneous feature work |
| Arabic translation quality drifts | Medium | Existing ar-audit verifier (key parity, order, placeholders) plus a native review pass |
| ZATCA sandbox unavailable | Medium | Preview/manual Fatoora path stays; issuance ships behind config and does not claim clearance |
| Scope creep into a full CRM rebuild | Medium | Extend `customers`; lead/WhatsApp/sales-link are the only CRM scope in this plan |

## Explicitly out of scope

- Full zakat rules beyond the existing base and filing groundwork.
- Live ZATCA clearance until CSID onboarding and sandbox validation succeed.
- Mudad/Qiwa integrations before credentials and API access exist.
- Telematics until a provider is selected.
- A custom CRM, WMS, POS or e-commerce rebuild; use the shipped modules.
- Full multi-currency revaluation unless the pilot has material foreign-currency exposure.
- Moving app-local modules into packages before the MVP stabilizes.

## Execution protocol

1. Claim one work item. Create or update its spec first; list the exact API paths, entities, events and UI paths it touches.
2. Implement in the smallest coherent slice. Keep tenant/organization scoping and optimistic locking on every write.
3. Add unit tests for pure rules and an integration spec for every new API/UI path, self-contained.
4. Run the fast gate; then the full merge gate before review.
5. Update this plan's status table and the relevant spec changelog in the same change.
6. For migrations: include SQL + snapshot, review for drift, ask before applying locally.

## Status tracker

| ID | Work item | Milestone | Status |
|---|---|---|---|
| M0.1 | HR approval authorization + manager resolution | M0 | done — authorization module, manager field, submit guards, 10 unit tests |
| M0.2 | Seal approval-request CRUD | M0 | done — route is GET-only; engine is the only lifecycle writer |
| M0.3 | HR unique indexes migration | M0 | done — partial unique migration + snapshot; DB application awaits G3 |
| M0.4 | Employee document upload | M0 | done — detail page + AttachmentInput + Open action |
| M0.5 | Financial migration state + TC-SL-FIN-001 | M0 | done — missing integration spec added; migration application awaits G3 |
| M0.6 | Repo hygiene + template policy | M0 | done — template policy settled (G10): `template-sync` ignores app-local module folders, strips their registrations, and is green; the fixture change ships with this slice |
| M0.7 | Fleet master-data decision | M0 | done — `2026-10-19-fleet-master-data-ownership.md`; G7 approved and executed in M4.1 |
| M1.1 | Sales/freight → GL posting | M1 | done — six subscribers, posting command, posting-settings API/screen, source idempotency, unit + integration coverage |
| M1.2 | AR aging + statements | M1 | done — aging/statement read models, API + screens, unit + integration coverage |
| M1.3 | AP + WHT | M1 | done — vendors, invoices, payments, allocations, withholding contract, AP aging, screens, unit + integration coverage |
| M1.4 | ZATCA Phase 2 issuance | M1 | done — submission entity/migration, idempotent issuance, issue + list APIs, submissions screen, integration cases; signing/CSID remain gated |
| M1.5 | Bank reconciliation | M1 | done — statement/line entities, CSV import, conservative matcher, API + screen, unit + integration coverage |
| M1.6 | Multi-currency | M1 | deferred — the pilot is SAR-only; translation needs a base-currency setting, rate history and revaluation, and the ledger currently posts at rate 1. Re-open when a foreign-currency vendor/customer is in scope. |
| M2.1 | Compensation decisions | M2 | done — effective-dated compensation, ceiling parameter default 0, manual overtime, in-app payslips, calculated-run close fallback |
| M2.2 | Compensation + payroll engine | M2 | done — 8 entities, payroll commands/routes, payslips, approval targets, ledger posting, screen, unit + integration coverage |
| M2.3 | GOSI / WPS / EOSB | M2 | done — configurable GOSI, EOSB calculator, generic SIF exporter; bank certification and filing integrations remain external |
| M2.4 | Leave balances | M2 | done — `HrLeaveEntitlement` + `HrLeaveAccrual`, balance enforcement on create/update, idempotent monthly accrual, API + screens, six-locale i18n, unit + `TC-HR-008` coverage |
| M2.5 | Employee self-service | M2 | deferred — needs a staff identity/portal decision; not on the payroll critical path |
| M2.6 | Mudad / Qiwa | M2 | deferred — requires API access and credentials |
| M3.1 | Arabic `customers` / `sales` / `staff` | M3 | done — full `ar.json` for customers (2 880 keys), sales (1 508) and staff (2 066), key/order parity verified; `yarn i18n:check-sync` green |
| M3.2 | Lead domain | M3 | done — lead/pipeline/stage/lost-reason/history entities + migration, tenant toggle, CRUD + action APIs, duplicate check, one-time conversion with lineage, list/detail/pipeline/settings screens, `TC-CRM-LEAD-001`. Field-binding/shared-write-through deferred (Phase 3 of the spec) |
| M3.3 | WhatsApp channel | M3 | done — `@open-mercato/channel-whatsapp` adapter (text/media/template, HMAC webhook, GET handshake, health/credentials), hub GET verify + `verifyWebhookSubscription`, CRM phone fallback and `message` interactions, adapter + route unit tests, `TC-CRM-WA-001` |
| M3.4 | Deal ↔ sales link | M3 | done — nullable `deal_id` on quotes/orders/invoices + migration/snapshot, create/update/list filters and projections, sales-injected deal tab, six-locale i18n, integration spec `TC-SALES-DEAL-001` |
| M3.5 | Telephony → CRM timeline | M3 | done — `phone_calls.call.completed` transition event, customers subscriber matching by email/phone with deterministic dedupe, `call` interactions with recording/duration; unit tests |
| M3.6 | CRM/sales portal pages | M3 | deferred — the pilot is operator-led; portal self-service for deals/orders/invoices is not on the critical path. Re-open when the customer portal scope is confirmed. |
| M4.1 | Master-data consolidation | M4 | done — `transport_vehicles` is the single register; fleet rows copied by id (existing plates merged), child refs verified, `fleet_vehicles` dropped, fleet reads/writes moved to the transport register; backup at `.mercato/backups/m4.1-fleet-before.sql` |
| M4.2 | Maintenance + work orders | M4 | done — `fleet_operations` module: schedules, work orders, parts/labor, close action, GL posting, screens, unit + integration coverage |
| M4.3 | Fuel / insurance / violations | M4 | done — fuel logs, insurance policies (with GL posting), traffic violations, dashboard summary; Saudi violation provider adapter deferred |
| M4.4 | Dashboards, trip cancel, portals, rental/school invoicing | M4 | done — transport dashboard, trip cancel, freight portal respond pages + origin-pinned API, rental/student sales-bridge invoicing, HR custody approval wiring |
| M4.5 | Telematics adapter | M4 | deferred (P3) — no provider selected; contract and SSRF-safe ingestion to be designed with the chosen vendor |
| M5.1 | Module packaging decision | M5 | done — decision record `2026-10-19-module-packaging-decision.md`: stay app-local through the pilot; revisit after a full production cycle and G10 |
| M5.2 | Template defaults | M5 | done — G10 settled: `template-sync` ignores app-local modules and strips their registrations; `yarn template:sync` green. Stale unregistered template copies are noted for a separate cleanup. Saudi first-tenant defaults remain the onboarding/setup path |
| M5.3 | QA matrix + deployment | M5 | partially done — gates on 2026-10-20: generate, db:generate, db:migrate (local, 14 migrations), typecheck, lint, build:packages, build:app, app unit tests (1 235), i18n sync, Arabic audit and template sync green. `yarn test` stops at the known Windows-only `@open-mercato/queue` EPERM failure. The M1–M4 targeted integration set (12 spec files, 14 tests: financial posting/AR/AP/bank, fleet custody/ops, HR payroll/leave, Saudi plugin, trip cancel, CRM leads, sales deal link) passed against a local dev server on 2026-10-20; the full Playwright suite still needs a clean run. Railway deployment is external |
| M5.4 | Pilot readiness checklist | M5 | documented in `.ai/qa/pilot-readiness.md`; local migrations applied and M4.1 executed on 2026-10-20, remaining items are operator-, counsel- and credential-gated |
