import { Migration } from '@mikro-orm/migrations';

export class Migration20260823085716_progress extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "progress_job_repair_cells" add "lease_token" text null, add "lease_until" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "progress_job_repair_cells" drop column "lease_token", drop column "lease_until";`);
  }

}
