import { Migration } from '@mikro-orm/migrations';

export class Migration20261019195519_hr_management extends Migration {

  override name = 'Migration20261019195519';

  override up(): void | Promise<void> {
    this.addSql(`create table "hr_employee_compensations" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "effective_from" date not null, "basic_salary" numeric(18,4) not null default '0', "housing_allowance" numeric(18,4) not null default '0', "transport_allowance" numeric(18,4) not null default '0', "other_allowance" numeric(18,4) not null default '0', "currency_code" text not null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_employee_compensations_employee_idx" on "hr_employee_compensations" ("organization_id", "employee_id", "effective_from");`);
    this.addSql(`create index "hr_employee_compensations_tenant_org_idx" on "hr_employee_compensations" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_employee_incentives" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "incentive_type" text not null, "amount" numeric(18,4) not null default '0', "currency_code" text not null, "period_start" date null, "period_end" date null, "reason" text not null, "status" text not null default 'pending', "approval_request_id" uuid null, "decided_by_user_id" uuid null, "decided_at" timestamptz null, "payroll_run_id" uuid null, "payslip_id" uuid null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_employee_incentives_employee_idx" on "hr_employee_incentives" ("organization_id", "employee_id", "status");`);
    this.addSql(`create index "hr_employee_incentives_tenant_org_idx" on "hr_employee_incentives" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_employee_loans" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "principal_amount" numeric(18,4) not null default '0', "currency_code" text not null, "instalment_count" int not null default 1, "instalment_amount" numeric(18,4) not null default '0', "first_due_on" date not null, "outstanding_amount" numeric(18,4) not null default '0', "reason" text null, "status" text not null default 'pending', "approval_request_id" uuid null, "decided_by_user_id" uuid null, "decided_at" timestamptz null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_employee_loans_employee_idx" on "hr_employee_loans" ("organization_id", "employee_id", "status");`);
    this.addSql(`create index "hr_employee_loans_tenant_org_idx" on "hr_employee_loans" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_employee_penalties" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "penalty_type" text not null, "incident_on" date not null, "amount" numeric(18,4) null, "suspended_days" int null, "reason" text not null, "status" text not null default 'pending', "approval_request_id" uuid null, "decided_by_user_id" uuid null, "decided_at" timestamptz null, "payroll_run_id" uuid null, "payslip_id" uuid null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_employee_penalties_employee_idx" on "hr_employee_penalties" ("organization_id", "employee_id", "status");`);
    this.addSql(`create index "hr_employee_penalties_tenant_org_idx" on "hr_employee_penalties" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_loan_instalments" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "loan_id" uuid not null, "sequence" int not null, "due_on" date not null, "amount" numeric(18,4) not null default '0', "status" text not null default 'scheduled', "payroll_run_id" uuid null, "payslip_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "hr_loan_instalments_due_idx" on "hr_loan_instalments" ("organization_id", "status", "due_on");`);
    this.addSql(`create index "hr_loan_instalments_loan_idx" on "hr_loan_instalments" ("loan_id", "sequence");`);

    this.addSql(`create table "hr_payroll_runs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "period_start" date not null, "period_end" date not null, "payment_date" date not null, "status" text not null default 'draft', "currency_code" text not null, "gross_total" numeric(18,4) not null default '0', "deduction_total" numeric(18,4) not null default '0', "net_total" numeric(18,4) not null default '0', "employee_count" int not null default 0, "calculated_at" timestamptz null, "approval_request_id" uuid null, "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "hr_payroll_runs_period_idx" on "hr_payroll_runs" ("organization_id", "period_start", "period_end");`);
    this.addSql(`create index "hr_payroll_runs_tenant_org_idx" on "hr_payroll_runs" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_payslips" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "payroll_run_id" uuid not null, "employee_id" uuid not null, "gross_amount" numeric(18,4) not null default '0', "deduction_amount" numeric(18,4) not null default '0', "net_amount" numeric(18,4) not null default '0', "status" text not null default 'draft', "worked_days" numeric(8,2) not null default '0', "paid_leave_days" numeric(8,2) not null default '0', "unpaid_leave_days" numeric(8,2) not null default '0', "absence_days" numeric(8,2) not null default '0', "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "hr_payslips_employee_idx" on "hr_payslips" ("organization_id", "employee_id");`);
    this.addSql(`create index "hr_payslips_run_idx" on "hr_payslips" ("payroll_run_id");`);

    this.addSql(`create table "hr_payslip_lines" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "payslip_id" uuid not null, "kind" text not null, "code" text not null, "label" text not null, "amount" numeric(18,4) not null default '0', "source_entity_type" text null, "source_entity_id" uuid null, "sequence" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "hr_payslip_lines_payslip_idx" on "hr_payslip_lines" ("payslip_id", "sequence");`);

    this.addSql(`alter table "hr_employees" add "bank_iban" text null;`);

    this.addSql(`alter table "hr_employee_incentives" add constraint "hr_employee_incentives_incentive_type_check" check ("incentive_type" in ('bonus', 'commission', 'allowance', 'overtime_pay'));`);
    this.addSql(`alter table "hr_employee_incentives" add constraint "hr_employee_incentives_status_check" check ("status" in ('pending', 'approved', 'rejected', 'cancelled', 'settling', 'settled'));`);

    this.addSql(`alter table "hr_employee_loans" add constraint "hr_employee_loans_status_check" check ("status" in ('pending', 'approved', 'rejected', 'cancelled', 'settling', 'settled'));`);

    this.addSql(`alter table "hr_employee_penalties" add constraint "hr_employee_penalties_penalty_type_check" check ("penalty_type" in ('deduction', 'written_warning', 'suspension_days'));`);
    this.addSql(`alter table "hr_employee_penalties" add constraint "hr_employee_penalties_status_check" check ("status" in ('pending', 'approved', 'rejected', 'cancelled', 'settling', 'settled'));`);

    this.addSql(`alter table "hr_loan_instalments" add constraint "hr_loan_instalments_status_check" check ("status" in ('scheduled', 'deducted', 'skipped', 'written_off'));`);

    this.addSql(`alter table "hr_payroll_runs" add constraint "hr_payroll_runs_status_check" check ("status" in ('draft', 'calculated', 'submitted', 'approved', 'paid', 'closed'));`);

    this.addSql(`alter table "hr_payslips" add constraint "hr_payslips_status_check" check ("status" in ('draft', 'approved', 'paid'));`);

    this.addSql(`alter table "hr_payslip_lines" add constraint "hr_payslip_lines_kind_check" check ("kind" in ('earning', 'deduction'));`);
    this.addSql(`alter table "hr_payslip_lines" add constraint "hr_payslip_lines_code_check" check ("code" in ('basic', 'allowance', 'overtime', 'incentive', 'loan_instalment', 'penalty', 'unpaid_leave', 'absence', 'manual'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "hr_employees" drop column "bank_iban";`);
  }

}
