import { Migration } from '@mikro-orm/migrations';

export class Migration20260928222810_marketing_automation extends Migration {

  override name = 'Migration20260928222810';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_inbound_hooks" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "campaign_id" uuid not null, "name" text not null, "revoked_at" timestamptz null, "received_count" int not null default 0, "last_received_at" timestamptz null, "last_outcome" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_inbound_hooks_campaign_idx" on "marketing_inbound_hooks" ("tenant_id", "organization_id", "campaign_id");`);
    this.addSql(`create index "mkt_inbound_hooks_scope_idx" on "marketing_inbound_hooks" ("tenant_id", "organization_id", "deleted_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_inbound_hooks" cascade;`);
  }

}
