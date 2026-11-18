import { Migration } from '@mikro-orm/migrations';

export class Migration20260825120000_customers extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_email_conversation_shares" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "person_entity_id" uuid not null, "owner_user_id" uuid not null, "shared_by_user_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "customer_email_conversation_shares_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_email_conv_shares_lookup_idx" on "customer_email_conversation_shares" ("tenant_id", "organization_id", "person_entity_id") where "deleted_at" is null;`);
    this.addSql(`create index "customer_email_conv_shares_owner_idx" on "customer_email_conversation_shares" ("tenant_id", "owner_user_id") where "deleted_at" is null;`);
    this.addSql(`create unique index "customer_email_conv_shares_uq" on "customer_email_conversation_shares" ("tenant_id", "person_entity_id", "owner_user_id") where "deleted_at" is null;`);

    this.addSql(`alter table "customer_email_conversation_shares" add constraint "customer_email_conversation_shares_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_email_conversation_shares" drop constraint if exists "customer_email_conversation_shares_person_entity_id_foreign";`);
    this.addSql(`drop table if exists "customer_email_conversation_shares" cascade;`);
  }

}
