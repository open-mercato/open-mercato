import { Migration } from '@mikro-orm/migrations';

export class Migration20251219052928 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "rule_execution_logs" alter column "entity_id" type text using ("entity_id"::text);`);

    this.addSql(`alter table "rule_execution_logs" alter column "entity_id" type varchar(255) using ("entity_id"::varchar(255));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "rule_execution_logs" alter column "entity_id" drop default;`);
    this.addSql(`alter table "rule_execution_logs" alter column "entity_id" type uuid using ("entity_id"::text::uuid);`);
  }

}
