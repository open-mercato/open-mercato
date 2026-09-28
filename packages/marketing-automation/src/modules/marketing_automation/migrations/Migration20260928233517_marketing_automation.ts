import { Migration } from '@mikro-orm/migrations';

export class Migration20260928233517_marketing_automation extends Migration {

  override name = 'Migration20260928233517';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_segment_snapshots" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "segment_id" uuid not null, "day" text not null, "size" int not null, "qualifier" text not null, "taken_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "mkt_segment_snapshots_idx" on "marketing_segment_snapshots" ("tenant_id", "organization_id", "segment_id", "day");`);
    this.addSql(`alter table "marketing_segment_snapshots" add constraint "marketing_segment_snapshot_day_uniq" unique ("tenant_id", "organization_id", "segment_id", "day");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_segment_snapshots" cascade;`);
  }

}
