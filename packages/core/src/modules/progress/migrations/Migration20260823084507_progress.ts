import { Migration } from '@mikro-orm/migrations';

export class Migration20260823084507_progress extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "progress_job_repair_cells" ("job_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid null, "cell" text not null, "due_at" timestamptz not null, "attempts" int not null default 0, "reason" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("job_id"));`);
    this.addSql(`create index "progress_job_repair_cells_due_idx" on "progress_job_repair_cells" ("tenant_id", "organization_id", "due_at", "job_id");`);
  }

}
