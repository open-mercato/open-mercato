import { Migration } from '@mikro-orm/migrations';

export class Migration20260810120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sync_runs" add column "parameters" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sync_runs" drop column "parameters";`);
  }

}
