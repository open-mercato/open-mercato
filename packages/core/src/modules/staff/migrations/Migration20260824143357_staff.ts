import { Migration } from '@mikro-orm/migrations';

export class Migration20260824143357_staff extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "staff_time_entries" drop constraint if exists "staff_time_entries_source_check";`);

    this.addSql(`alter table "staff_time_reports" drop constraint if exists "staff_time_reports_grouping_check";`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "staff_time_entries" add constraint "staff_time_entries_source_check" check ("source" in ('manual', 'timer', 'kiosk', 'mobile'));`);

    this.addSql(`alter table "staff_time_reports" add constraint "staff_time_reports_grouping_check" check ("grouping" in ('project_task', 'project_person', 'project_day'));`);
  }

}
