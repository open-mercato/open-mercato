import { Migration } from '@mikro-orm/migrations';

export class Migration20251101095000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "entity_index_jobs" add column "processed_count" int null;');
    this.addSql('alter table "entity_index_jobs" add column "total_count" int null;');
    this.addSql('alter table "entity_index_jobs" add column "heartbeat_at" timestamptz null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "entity_index_jobs" drop column "heartbeat_at";');
    this.addSql('alter table "entity_index_jobs" drop column "total_count";');
    this.addSql('alter table "entity_index_jobs" drop column "processed_count";');
  }
}

