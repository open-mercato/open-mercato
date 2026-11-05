import { Migration } from '@mikro-orm/migrations';

export class Migration20260417235407 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_interactions" add column "linked_entities" jsonb null, add column "guest_permissions" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_interactions" drop column "linked_entities", drop column "guest_permissions";`);
  }

}
