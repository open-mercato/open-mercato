import { Migration } from '@mikro-orm/migrations';

export class Migration20260922095316_customer_groups extends Migration {

  override name = 'Migration20260922095316';

  override up(): void | Promise<void> {
    this.addSql(`create table "customer_groups" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "description" text null, "kind" text not null, "parent_id" uuid null, "priority" int not null, "is_default" boolean not null default false, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "customer_groups_tenant_default_unique" on "customer_groups" ("tenant_id") where "is_default" and "deleted_at" is null;`);
    this.addSql(`create index "customer_groups_parent_idx" on "customer_groups" ("parent_id");`);
    this.addSql(`create index "customer_groups_tenant_idx" on "customer_groups" ("tenant_id");`);
    this.addSql(`alter table "customer_groups" add constraint "customer_groups_tenant_priority_unique" unique ("tenant_id", "priority");`);
    this.addSql(`alter table "customer_groups" add constraint "customer_groups_tenant_code_unique" unique ("tenant_id", "code");`);

    this.addSql(`create table "customer_group_memberships" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid null, "tenant_id" uuid not null, "group_id" uuid not null, "customer_id" uuid not null, "source" text not null default 'manual', "valid_from" timestamptz null, "valid_until" timestamptz null, "assigned_by_user_id" uuid null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "customer_group_memberships_active_unique" on "customer_group_memberships" ("tenant_id", "group_id", "customer_id") where "deleted_at" is null;`);
    this.addSql(`create index "customer_group_memberships_hot_path_idx" on "customer_group_memberships" ("tenant_id", "customer_id", "valid_from", "valid_until");`);
    this.addSql(`create index "customer_group_memberships_tenant_idx" on "customer_group_memberships" ("tenant_id");`);
  }

}
