import { Migration } from '@mikro-orm/migrations';

export class Migration20251115103000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "module_configs" ("id" uuid not null default gen_random_uuid(), "module_id" text not null, "name" text not null, "value_json" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "module_configs_pkey" primary key ("id"));`);
    this.addSql(`alter table "module_configs" add constraint "module_configs_module_name_unique" unique ("module_id", "name");`);
    this.addSql(`create index "module_configs_module_idx" on "module_configs" ("module_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "module_configs" cascade;`);
  }

}

