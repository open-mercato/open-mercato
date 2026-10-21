# Pilot QA matrix and readiness checklist

**Status:** Living document — automated gates recorded 2026-10-20; environment-bound gates remain open
**Created:** 2026-10-20
**Scope:** the Saudi ERP pilot (fleet/operations, CRM, finance, HR)

## Automated gates (run on 2026-10-19/20)

| Gate | Command | Result |
|---|---|---|
| Generators | `yarn generate` | pass |
| Migrations generated | `yarn db:generate` | pass (new migrations reviewed) |
| Migrations applied (local) | `yarn db:migrate` | pass 2026-10-20 — financial ×3, HR ×4, fleet_operations, sales, saudi_localization, student_transport, transport_operations ×2, vehicle_rentals. The `query_index` reindex-declaration reader warned about `src`/`dist` paths; it did not block the migration |
| Typecheck | `tsc --noEmit` (workspace) | pass |
| Lint | `yarn lint` | pass (0 errors, warnings unchanged) |
| Package build | `yarn build:packages` | pass (39 tasks) |
| App build | `yarn build:app` | pass |
| Unit tests (app) | `yarn workspace @open-mercato/app test` | 1 235 passed / 169 suites |
| Unit tests (core) | `yarn workspace @open-mercato/core test` | run separately; `yarn test` stops at the known Windows-only `@open-mercato/queue` EPERM failure |
| i18n sync / usage / Arabic audit | `yarn i18n:check-sync`, `yarn i18n:check-usage`, `ar-audit/verify.mjs` | sync pass; usage has 4 pre-existing financial keys missing and advisory unused keys; Arabic audit OK for `hr_management` (573 keys) and `transport_operations` (183 keys) |
| Template sync | `yarn template:sync` | pass — app-local modules ignored on both sides and stripped from the template registrations |
| Integration suite | `yarn test:integration` | not run in this environment — needs the Playwright stack + a running app; CI must run it |

## Pilot smoke flows

Each flow names the spec that covers it. They must be green in CI before the pilot starts.

1. **Invoice → GL → VAT return** — `saudi_localization/__integration__/TC-SL-FIN-001`
2. **Sales posting** — `financial/__integration__/TC-FINANCIAL-003`
3. **AR aging / statement** — `financial/__integration__/TC-FINANCIAL-004`
4. **AP + withholding** — `financial/__integration__/TC-FINANCIAL-005`
5. **Bank reconciliation** — `financial/__integration__/TC-FINANCIAL-006`
6. **Hire → payroll → payslip → GL** — `hr_management/__integration__/TC-HR-007`
7. **Leave entitlement → balance refusal → accrual → unpaid payslip** — `hr_management/__integration__/TC-HR-008`
8. **Lead → duplicate check → convert → deal** — `customers/__integration__/TC-CRM-LEAD-001`
8. **Deal → quote/order/invoice** — `sales/__integration__/TC-SALES-DEAL-001`
9. **WhatsApp inbound → CRM timeline** — `customers/__integration__/TC-CRM-WA-001` (requires `OM_ENABLE_TEST_CHANNEL_SEEDING`)
10. **Vehicle → schedule → work order → complete → GL** — `fleet_operations/__integration__/TC-FLEET-OPS-001`
11. **Trip → dispatch → cancel → driver release** — `transport_operations/__integration__/TC-TRANSPORT-002`
12. **Freight abstract → customer portal accept/dispute → invoice** — `freight_operations/__integration__/TC-FREIGHT-006`, `TC-FREIGHT-007`, plus the portal route checks in this cycle
13. **Rental return → invoice** — extend `vehicle_rentals/__integration__/TC-RENTAL-001` or add the invoice assertion to the same fixture
14. **Student subscription → invoice period** — extend `student_transport/__integration__/TC-STUDENT-001`

## Deployment (Railway)

Follow `.ai/specs/2026-05-12-railway-one-command-deploy.md` and `apps/docs/docs/deployment/railway.mdx`.

- [ ] Postgres and object storage provisioned; `DATABASE_URL`, `JWT_SECRET`, `APP_URL`, `OM_ENCRYPTION_*`/KMS set.
- [ ] `yarn db:migrate` run once on the target database after a verified backup.
- [ ] Health checks green: `/api/health`, integrations health, WhatsApp channel health.
- [ ] Error reporting and structured logs shipped (see `runtime/error-reporting`).
- [ ] Backup + restore exercised once.
- [ ] `OM_ENABLE_TEST_CHANNEL_SEEDING` unset in production (route returns 404).

## Pilot readiness checklist

- [x] Migrations applied and every module snapshot reviewed (local 2026-10-20).
- [ ] Default role ACLs synced (`yarn mercato auth sync-role-acls`), portal ACLs synced (`yarn mercato customer_accounts sync-customer-role-acls`).
- [ ] Arabic audit green for every enabled module (`ar-audit/verify.mjs`, app dictionary parity).
- [ ] Saudi CoA seeded and VAT settings confirmed.
- [ ] Opening balances imported and reconciled against the trial balance.
- [ ] Data import plan for customers, vehicles, employees and vendors executed.
- [ ] ZATCA CSID onboarding scheduled; issuance remains in preview mode until sandbox validation succeeds.
- [ ] WPS/SIF format confirmed with the bank; Mudad/Qiwa access requested.
- [ ] GOSI/EOSB rates and the payroll deduction ceiling confirmed with counsel.
- [x] Fleet master-data consolidation (M4.1) executed: `transport_vehicles` is the single register, `fleet_vehicles` dropped, pre-migration backup verified.
- [ ] Security review of the diff completed before go-live.
