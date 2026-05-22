import { Migration } from '@mikro-orm/migrations';

export class Migration20260411075533 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_dictionary_kind_settings" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "kind" text not null, "selection_mode" text not null default 'single', "visible_in_tags" boolean not null default true, "sort_order" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_dictionary_kind_settings_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_dict_kind_settings_scope_idx" on "customer_dictionary_kind_settings" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "customer_dictionary_kind_settings" add constraint "customer_dict_kind_settings_unique" unique ("organization_id", "tenant_id", "kind");`);

    this.addSql(`create table "customer_labels" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "user_id" uuid not null, "slug" text not null, "label" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "customer_labels_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_labels_scope_idx" on "customer_labels" ("organization_id", "tenant_id", "user_id");`);
    this.addSql(`alter table "customer_labels" add constraint "customer_labels_unique" unique ("user_id", "tenant_id", "organization_id", "slug");`);

    this.addSql(`create table "customer_label_assignments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "user_id" uuid not null, "label_id" uuid not null, "entity_id" uuid not null, "created_at" timestamptz not null, constraint "customer_label_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "customer_label_assignments_entity_idx" on "customer_label_assignments" ("entity_id");`);
    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_unique" unique ("label_id", "entity_id");`);

    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_label_id_foreign" foreign key ("label_id") references "customer_labels" ("id") on update cascade;`);
    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_label_assignments" drop constraint if exists "customer_label_assignments_entity_id_foreign";`);
    this.addSql(`alter table "customer_label_assignments" drop constraint "customer_label_assignments_label_id_foreign";`);
    this.addSql(`drop table if exists "customer_label_assignments" cascade;`);
    this.addSql(`drop table if exists "customer_labels" cascade;`);
    this.addSql(`drop table if exists "customer_dictionary_kind_settings" cascade;`);
  }

}
