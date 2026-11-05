import { Migration } from '@mikro-orm/migrations';

export class Migration20260419135145 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "business_rules" alter column "condition_expression" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`update "business_rules" set "condition_expression" = '{}'::jsonb where "condition_expression" is null;`);
    this.addSql(`alter table "business_rules" alter column "condition_expression" set not null;`);
  }

}
