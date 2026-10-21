import { Migration } from '@mikro-orm/migrations';

export class Migration20261020035824_hr_management extends Migration {

  override name = 'Migration20261020035824';

  override up(): void | Promise<void> {
    this.addSql(`create table "hr_leave_accruals" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "leave_type" text not null, "accrual_month" date not null, "days" numeric(8,2) not null default '0', "entitlement_id" uuid null, "source" text not null default 'monthly', "note" text null, "created_by" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "hr_leave_accruals_unique_idx" on "hr_leave_accruals" ("organization_id", "tenant_id", "employee_id", "leave_type", "accrual_month");`);
    this.addSql(`create index "hr_leave_accruals_employee_idx" on "hr_leave_accruals" ("organization_id", "employee_id", "leave_type", "accrual_month");`);
    this.addSql(`create index "hr_leave_accruals_tenant_org_idx" on "hr_leave_accruals" ("tenant_id", "organization_id");`);

    this.addSql(`create table "hr_leave_entitlements" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "employee_id" uuid not null, "leave_type" text not null, "period_start" date not null, "period_end" date not null, "entitled_days" numeric(8,2) not null default '0', "carry_over_days" numeric(8,2) not null default '0', "notes" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "hr_leave_entitlements_unique_idx" on "hr_leave_entitlements" ("organization_id", "tenant_id", "employee_id", "leave_type", "period_start") where deleted_at is null;`);
    this.addSql(`create index "hr_leave_entitlements_employee_idx" on "hr_leave_entitlements" ("organization_id", "employee_id", "leave_type", "period_start");`);
    this.addSql(`create index "hr_leave_entitlements_tenant_org_idx" on "hr_leave_entitlements" ("tenant_id", "organization_id");`);

    this.addSql(`alter table "hr_leave_accruals" add constraint "hr_leave_accruals_leave_type_check" check ("leave_type" in ('annual', 'sick', 'unpaid', 'emergency', 'maternity', 'other'));`);
    this.addSql(`alter table "hr_leave_accruals" add constraint "hr_leave_accruals_source_check" check ("source" in ('monthly', 'manual'));`);

    this.addSql(`alter table "hr_leave_entitlements" add constraint "hr_leave_entitlements_leave_type_check" check ("leave_type" in ('annual', 'sick', 'unpaid', 'emergency', 'maternity', 'other'));`);
  }

}
