import { Migration } from '@mikro-orm/migrations';

export class Migration20260928232253_marketing_automation extends Migration {

  override name = 'Migration20260928232253';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_segments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "slug" text not null, "name" text not null, "description" text null, "expression" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_segments_scope_idx" on "marketing_segments" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create unique index "marketing_segments_slug_uniq" on "marketing_segments" ("tenant_id", "organization_id", "slug") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_segments" cascade;`);
  }

}
