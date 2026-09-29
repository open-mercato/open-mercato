import { Migration } from '@mikro-orm/migrations';

export class Migration20260929001506_marketing_automation extends Migration {

  override name = 'Migration20260929001506';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_contact_preferences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "max_per_week" int null, "paused_until" timestamptz null, "source" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "marketing_contact_preferences" add constraint "marketing_contact_preference_uniq" unique ("tenant_id", "organization_id", "subject_entity_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_contact_preferences" cascade;`);
  }

}
