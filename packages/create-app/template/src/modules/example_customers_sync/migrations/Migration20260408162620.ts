import { Migration } from '@mikro-orm/migrations';

export class Migration20260408162620 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "example_customer_interaction_mappings" add column "deleted_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "example_customer_interaction_mappings" drop column "deleted_at";`);
  }

}
