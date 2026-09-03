import { Migration } from '@mikro-orm/migrations';

export class Migration20260729061736_workflows extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "workflow_instances" add "is_dry_run" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "workflow_instances" drop column "is_dry_run";`);
  }

}
