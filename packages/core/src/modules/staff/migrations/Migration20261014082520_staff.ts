import { Migration } from '@mikro-orm/migrations';

export class Migration20261014082520_staff extends Migration {

  override name = 'Migration20261014082520';

  override up(): void | Promise<void> {
    this.addSql(`alter table "staff_time_entries" alter column "rate_override_amount" type numeric using ("rate_override_amount"::numeric);`);

    this.addSql(`alter table "staff_time_projects" alter column "budget_value" type numeric using ("budget_value"::numeric);`);
    this.addSql(`alter table "staff_time_projects" alter column "hourly_rate" type numeric using ("hourly_rate"::numeric);`);

    this.addSql(`alter table "staff_time_reports" alter column "total_amount" type numeric using ("total_amount"::numeric);`);

    this.addSql(`alter table "staff_time_report_entries" alter column "frozen_amount" type numeric using ("frozen_amount"::numeric);`);
    this.addSql(`alter table "staff_time_report_entries" alter column "frozen_rate_amount" type numeric using ("frozen_rate_amount"::numeric);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "staff_time_entries" alter column "rate_override_amount" type numeric(14,4) using ("rate_override_amount"::numeric(14,4));`);

    this.addSql(`alter table "staff_time_projects" alter column "hourly_rate" type numeric(14,4) using ("hourly_rate"::numeric(14,4));`);
    this.addSql(`alter table "staff_time_projects" alter column "budget_value" type numeric(14,4) using ("budget_value"::numeric(14,4));`);

    this.addSql(`alter table "staff_time_report_entries" alter column "frozen_rate_amount" type numeric(14,4) using ("frozen_rate_amount"::numeric(14,4));`);
    this.addSql(`alter table "staff_time_report_entries" alter column "frozen_amount" type numeric(14,2) using ("frozen_amount"::numeric(14,2));`);

    this.addSql(`alter table "staff_time_reports" alter column "total_amount" type numeric(14,2) using ("total_amount"::numeric(14,2));`);
  }

}
