import { Migration } from '@mikro-orm/migrations';

export class Migration20251102200432 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "rule_sets" ("id" uuid not null default gen_random_uuid(), "set_id" varchar(50) not null, "set_name" varchar(200) not null, "description" text null, "enabled" boolean not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_by" varchar(50) null, "updated_by" varchar(50) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "rule_sets_pkey" primary key ("id"));`);
    this.addSql(`create index "rule_sets_enabled_idx" on "rule_sets" ("enabled");`);
    this.addSql(`create index "rule_sets_tenant_org_idx" on "rule_sets" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "rule_sets" add constraint "rule_sets_set_id_tenant_id_unique" unique ("set_id", "tenant_id");`);

    this.addSql(`create table "rule_set_members" ("id" uuid not null default gen_random_uuid(), "rule_set_id" uuid not null, "rule_id" uuid not null, "sequence" int not null default 0, "enabled" boolean not null default true, "tenant_id" uuid not null, "organization_id" uuid not null, "created_at" timestamptz not null, constraint "rule_set_members_pkey" primary key ("id"));`);
    this.addSql(`create index "rule_set_members_tenant_org_idx" on "rule_set_members" ("tenant_id", "organization_id");`);
    this.addSql(`create index "rule_set_members_rule_idx" on "rule_set_members" ("rule_id");`);
    this.addSql(`create index "rule_set_members_set_idx" on "rule_set_members" ("rule_set_id", "sequence");`);
    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_set_id_rule_id_unique" unique ("rule_set_id", "rule_id");`);

    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_set_id_foreign" foreign key ("rule_set_id") references "rule_sets" ("id") on update cascade;`);
    this.addSql(`alter table "rule_set_members" add constraint "rule_set_members_rule_id_foreign" foreign key ("rule_id") references "business_rules" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "rule_set_members" drop constraint "rule_set_members_rule_set_id_foreign";`);

    this.addSql(`drop table if exists "rule_sets" cascade;`);

    this.addSql(`drop table if exists "rule_set_members" cascade;`);
  }

}
