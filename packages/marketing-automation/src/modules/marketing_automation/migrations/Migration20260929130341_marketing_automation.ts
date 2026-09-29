import { Migration } from '@mikro-orm/migrations';

export class Migration20260929130341_marketing_automation extends Migration {

  override name = 'Migration20260929130341';

  override up(): void | Promise<void> {
    this.addSql(`create table "marketing_subject_erasures" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "subject_entity_id" uuid not null, "erased_at" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "marketing_subject_erasures" add constraint "marketing_subject_erasures_subject_uniq" unique ("tenant_id", "organization_id", "subject_entity_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "marketing_subject_erasures" cascade;`);
  }

}
