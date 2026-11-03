import { Migration } from '@mikro-orm/migrations';

export class Migration20261005103947_marketing_automation extends Migration {

  override name = 'Migration20261005103947';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_inbound_requests" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "hook_id" uuid not null, "subject_entity_id" uuid null, "outcome" text not null, "body" jsonb null, "body_bytes" int not null, "received_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_inbound_requests_subject_idx" on "marketing_inbound_requests" ("tenant_id", "organization_id", "subject_entity_id");`);
    this.addSql(`create index "mkt_inbound_requests_hook_idx" on "marketing_inbound_requests" ("tenant_id", "organization_id", "hook_id", "received_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_inbound_requests" cascade;`);
  }

}
