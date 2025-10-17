import { Migration } from '@mikro-orm/migrations'

export class Migration20251201090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "user_sidebar_preferences" ("id" uuid not null default gen_random_uuid(), "user_id" uuid not null, "tenant_id" uuid null, "organization_id" uuid null, "locale" text not null, "settings_json" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz null, "deleted_at" timestamptz null, constraint "user_sidebar_preferences_pkey" primary key ("id"));`)

    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`)
    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_tenant_id_organization_id_locale_unique" unique ("user_id", "tenant_id", "organization_id", "locale");`)
    this.addSql(`create index "user_sidebar_preferences_user_id_index" on "user_sidebar_preferences" ("user_id");`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "user_sidebar_preferences" cascade;')
  }
}
