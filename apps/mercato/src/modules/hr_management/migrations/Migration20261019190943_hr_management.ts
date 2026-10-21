import { Migration } from '@mikro-orm/migrations';

export class Migration20261019190943_hr_management extends Migration {

  override name = 'Migration20261019190943';

  override up(): void | Promise<void> {
    this.addSql(`alter table "hr_employees" add "manager_employee_id" uuid null;`);
    this.addSql(`create index "hr_employees_manager_idx" on "hr_employees" ("organization_id", "manager_employee_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "hr_employees_manager_idx";`);
    this.addSql(`alter table "hr_employees" drop column "manager_employee_id";`);
  }

}
