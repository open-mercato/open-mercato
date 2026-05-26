import { Migration } from '@mikro-orm/migrations';

export class Migration20260417160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_entity_roles" add column "deleted_at" timestamptz null;`);
    this.addSql(`alter table "customer_entity_roles" drop constraint if exists "customer_entity_roles_unique";`);
    this.addSql(`create unique index "customer_entity_roles_active_unique" on "customer_entity_roles" ("entity_type", "entity_id", "role_type") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "customer_entity_roles_active_unique";`);
    this.addSql(`alter table "customer_entity_roles" add constraint "customer_entity_roles_unique" unique ("entity_type", "entity_id", "role_type");`);
    this.addSql(`alter table "customer_entity_roles" drop column "deleted_at";`);
  }

}
