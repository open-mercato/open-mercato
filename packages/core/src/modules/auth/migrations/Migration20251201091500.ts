import { Migration } from '@mikro-orm/migrations'

export class Migration20251201091500 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "role_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "role_id" uuid not null, "tenant_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "role_sidebar_preferences_pkey" primary key ("id"));`)

    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade;`)
    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_tenant_id_locale_unique" unique ("role_id", "tenant_id", "locale");`)
    this.addSql(`create index "role_sidebar_preferences_role_id_index" on "role_sidebar_preferences" ("role_id");`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "role_sidebar_preferences" cascade;')
  }
}
