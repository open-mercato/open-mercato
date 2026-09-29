import { Migration } from '@mikro-orm/migrations';

export class Migration20260929082002_marketing_automation extends Migration {

  override name = 'Migration20260929082002';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_value_boundaries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "boundaries" jsonb not null, "buyer_count" int not null default 0, "computed_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "marketing_value_boundaries" add constraint "mkt_value_boundaries_scope_uq" unique ("tenant_id", "organization_id");`);
  }

}
