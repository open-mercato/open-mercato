import { Migration } from '@mikro-orm/migrations';

export class Migration20261019090000_hr_unique_indexes extends Migration {

  override name = 'Migration20261019090000';

  override up(): void | Promise<void> {
    this.addSql(`drop index if exists "hr_departments_code_unique_idx";`);
    this.addSql(`create unique index "hr_departments_code_unique_idx" on "hr_departments" ("organization_id", "tenant_id", "code") where deleted_at is null and code is not null;`);
    this.addSql(`drop index if exists "hr_employees_number_unique_idx";`);
    this.addSql(`create unique index "hr_employees_number_unique_idx" on "hr_employees" ("organization_id", "tenant_id", "employee_number") where deleted_at is null;`);
    this.addSql(`drop index if exists "hr_employees_national_id_unique_idx";`);
    this.addSql(`create unique index "hr_employees_national_id_unique_idx" on "hr_employees" ("organization_id", "tenant_id", "national_id") where deleted_at is null;`);
    this.addSql(`drop index if exists "hr_driver_profiles_employee_unique_idx";`);
    this.addSql(`create unique index "hr_driver_profiles_employee_unique_idx" on "hr_driver_profiles" ("organization_id", "tenant_id", "employee_id") where deleted_at is null;`);
    this.addSql(`drop index if exists "hr_attendance_employee_date_unique_idx";`);
    this.addSql(`create unique index "hr_attendance_employee_date_unique_idx" on "hr_attendance_records" ("organization_id", "tenant_id", "employee_id", "date") where deleted_at is null;`);
    this.addSql(`drop index if exists "hr_approval_workflows_code_unique_idx";`);
    this.addSql(`create unique index "hr_approval_workflows_code_unique_idx" on "hr_approval_workflows" ("organization_id", "tenant_id", "code") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "hr_approval_workflows_code_unique_idx";`);
    this.addSql(`create index "hr_approval_workflows_code_unique_idx" on "hr_approval_workflows" ("organization_id", "tenant_id", "code");`);
    this.addSql(`drop index if exists "hr_attendance_employee_date_unique_idx";`);
    this.addSql(`create index "hr_attendance_employee_date_unique_idx" on "hr_attendance_records" ("organization_id", "tenant_id", "employee_id", "date");`);
    this.addSql(`drop index if exists "hr_driver_profiles_employee_unique_idx";`);
    this.addSql(`create index "hr_driver_profiles_employee_unique_idx" on "hr_driver_profiles" ("organization_id", "tenant_id", "employee_id");`);
    this.addSql(`drop index if exists "hr_employees_national_id_unique_idx";`);
    this.addSql(`create index "hr_employees_national_id_unique_idx" on "hr_employees" ("organization_id", "tenant_id", "national_id");`);
    this.addSql(`drop index if exists "hr_employees_number_unique_idx";`);
    this.addSql(`create index "hr_employees_number_unique_idx" on "hr_employees" ("organization_id", "tenant_id", "employee_number");`);
    this.addSql(`drop index if exists "hr_departments_code_unique_idx";`);
    this.addSql(`create index "hr_departments_code_unique_idx" on "hr_departments" ("organization_id", "tenant_id", "code");`);
  }

}
