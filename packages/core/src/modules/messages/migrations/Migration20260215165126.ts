import { Migration } from '@mikro-orm/migrations';

export class Migration20260215165126 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "message_confirmations" ("id" uuid not null default gen_random_uuid(), "message_id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid null, "confirmed" boolean not null default true, "confirmed_by_user_id" uuid null, "confirmed_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "message_confirmations_pkey" primary key ("id"));`);
    this.addSql(`create index "message_confirmations_scope_idx" on "message_confirmations" ("tenant_id", "organization_id");`);
    this.addSql(`create index "message_confirmations_message_idx" on "message_confirmations" ("message_id");`);
    this.addSql(`alter table "message_confirmations" add constraint "message_confirmations_message_unique" unique ("message_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "message_confirmations" cascade;`);
  }

}
