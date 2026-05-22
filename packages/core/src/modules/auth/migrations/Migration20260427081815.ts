import { Migration } from '@mikro-orm/migrations';

export class Migration20260427081815 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "sidebar_variants" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "locale" text not null, "name" text not null, "settings_json" jsonb null, "is_active" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`alter table "sidebar_variants" add constraint "sidebar_variants_user_id_tenant_id_locale_name_unique" unique ("user_id", "tenant_id", "locale", "name");`);

    this.addSql(`alter table "sidebar_variants" add constraint "sidebar_variants_user_id_foreign" foreign key ("user_id") references "users" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "sidebar_variants" cascade;`);
  }

}
