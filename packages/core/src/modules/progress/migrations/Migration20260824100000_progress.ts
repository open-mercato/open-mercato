import { Migration } from '@mikro-orm/migrations';

export class Migration20260824100000_progress extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "progress_job_repair_cells" add "lease_epoch" int not null default 0;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "progress_job_repair_cells" drop column "lease_epoch";`);
  }

}
