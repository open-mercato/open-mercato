import { Migration } from '@mikro-orm/migrations';

export class Migration20251102101500 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "entity_index_coverage" add column "vector_indexed_count" int not null default 0;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "entity_index_coverage" drop column "vector_indexed_count";');
  }
}
