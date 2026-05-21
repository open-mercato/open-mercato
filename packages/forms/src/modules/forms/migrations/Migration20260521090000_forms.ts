import { Migration } from '@mikro-orm/migrations';

export class Migration20260521090000_forms extends Migration {

  override up(): void | Promise<void> {
    // W5 (DP-6) — per-form retention window in days. Null keeps submissions
    // forever; a positive integer drives the retention-purge worker.
    this.addSql(`alter table "forms_form" add column "retention_days" int null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "forms_form" drop column "retention_days";`);
  }

}
