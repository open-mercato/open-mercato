import { Migration } from '@mikro-orm/migrations';

export class Migration20260928212727_marketing_automation extends Migration {

  override name = 'Migration20260928212727';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_content_blocks" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "key" text not null, "name" text not null, "html" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "mkt_content_blocks_scope_idx" on "marketing_content_blocks" ("tenant_id", "organization_id", "deleted_at");`);
    this.addSql(`create unique index "marketing_content_blocks_key_uniq" on "marketing_content_blocks" ("tenant_id", "organization_id", "key") where deleted_at is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_content_blocks" cascade;`);
  }

}
