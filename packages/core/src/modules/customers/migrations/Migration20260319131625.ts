import { Migration } from '@mikro-orm/migrations';

export class Migration20260319131625 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_interactions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "interaction_type" text not null, "title" text null, "body" text null, "status" text not null default 'planned', "scheduled_at" timestamptz null, "occurred_at" timestamptz null, "priority" int null, "author_user_id" uuid null, "owner_user_id" uuid null, "appearance_icon" text null, "appearance_color" text null, "source" text null, "deal_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "entity_id" uuid not null, constraint "customer_interactions_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_interactions_type_idx" on "customer_interactions" ("tenant_id", "organization_id", "interaction_type");`);
    this.addSql(`create index "customer_interactions_org_tenant_status_idx" on "customer_interactions" ("organization_id", "tenant_id", "status", "scheduled_at");`);
    this.addSql(`create index "customer_interactions_entity_status_scheduled_idx" on "customer_interactions" ("entity_id", "status", "scheduled_at", "created_at");`);

    this.addSql(`alter table "customer_interactions" add constraint "customer_interactions_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);
  }

}
