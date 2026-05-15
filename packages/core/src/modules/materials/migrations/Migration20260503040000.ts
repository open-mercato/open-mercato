import { Migration } from '@mikro-orm/migrations'

export class Migration20260503040000 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(`create table "material_lifecycle_events" (
      "id" uuid not null default gen_random_uuid(),
      "organization_id" uuid not null,
      "tenant_id" uuid not null,
      "material_id" uuid not null,
      "from_state" text not null,
      "to_state" text not null,
      "changed_by_user_id" uuid null,
      "reason" text null,
      "replacement_material_id" uuid null,
      "changed_at" timestamptz not null,
      "created_at" timestamptz not null,
      primary key ("id")
    );`)
    this.addSql(`create index "material_lifecycle_events_material_changed_idx" on "material_lifecycle_events" ("material_id", "changed_at" desc);`)
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "material_lifecycle_events" cascade;`)
  }
}
