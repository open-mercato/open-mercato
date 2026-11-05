import { Migration } from '@mikro-orm/migrations';

export class Migration20260406214502 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_entity_roles" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" uuid not null, "user_id" uuid not null, "role_type" text not null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_entity_roles_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_entity_roles_scope_idx" on "customer_entity_roles" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_entity_roles_entity_idx" on "customer_entity_roles" ("entity_type", "entity_id");`);
    this.addSql(`alter table "customer_entity_roles" add constraint "customer_entity_roles_unique" unique ("entity_type", "entity_id", "role_type");`);

    this.addSql(`alter table "customer_interactions" add column "pinned" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_interactions" drop column "pinned";`);
    this.addSql(`drop table if exists "customer_entity_roles" cascade;`);
  }

}
