import { Migration } from '@mikro-orm/migrations';

export class Migration20251212084132 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "search_tokens" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "field" text not null, "token_hash" text not null, "token" text null, "created_at" timestamptz not null, constraint "search_tokens_pkey" primary key ("id"));`);
    this.addSql(`create index "search_tokens_entity_idx" on "search_tokens" ("entity_type", "entity_id");`);
    this.addSql(`create index "search_tokens_lookup_idx" on "search_tokens" ("entity_type", "field", "token_hash", "tenant_id", "organization_id");`);
  }

}
