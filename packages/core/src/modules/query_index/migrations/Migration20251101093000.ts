import { Migration } from '@mikro-orm/migrations';

export class Migration20251101093000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "entity_index_jobs" add column "partition_index" int null;');
    this.addSql('alter table "entity_index_jobs" add column "partition_count" int null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "entity_index_jobs" drop column "partition_count";');
    this.addSql('alter table "entity_index_jobs" drop column "partition_index";');
  }
}
