import { Migration } from '@mikro-orm/migrations';

export class Migration20260527195446_communication_channels extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "channel_ingest_dead_letters" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "channel_id" uuid not null, "provider_key" text not null, "external_uid" text null, "external_message_id" text null, "error_class" text not null, "error_message" text not null, "raw_body" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "channel_ingest_dead_letters_created_idx" on "channel_ingest_dead_letters" ("tenant_id", "created_at");`);
    this.addSql(`create index "channel_ingest_dead_letters_channel_idx" on "channel_ingest_dead_letters" ("channel_id", "tenant_id");`);

    this.addSql(`create table "channel_thread_tokens" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid null, "message_thread_id" uuid not null, "token" text not null, "created_at" timestamptz not null, "last_seen_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "channel_thread_tokens_thread_idx" on "channel_thread_tokens" ("message_thread_id", "tenant_id");`);
    this.addSql(`alter table "channel_thread_tokens" add constraint "channel_thread_tokens_token_uq" unique ("tenant_id", "token");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "channel_ingest_dead_letters";`);
    this.addSql(`drop table if exists "channel_thread_tokens";`);
  }

}
