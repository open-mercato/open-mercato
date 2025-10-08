import { Migration } from '@mikro-orm/migrations';

export class Migration20251008120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "organizations" add column "parent_id" uuid null, add column "root_id" uuid null, add column "tree_path" text null, add column "depth" int not null default 0, add column "ancestor_ids" jsonb not null default '[]', add column "child_ids" jsonb not null default '[]', add column "descendant_ids" jsonb not null default '[]';`);

    this.addSql(`alter table "organizations" add constraint "organizations_parent_id_foreign" foreign key ("parent_id") references "organizations" ("id") on update cascade on delete set null;`);

    this.addSql(`create index "organizations_tenant_depth_idx" on "organizations" ("tenant_id", "depth");`);
    this.addSql(`create index "organizations_parent_idx" on "organizations" ("parent_id");`);
    this.addSql(`create index "organizations_root_idx" on "organizations" ("root_id");`);

    this.addSql(`update "organizations" set "root_id" = "id", "tree_path" = "id"::text where "root_id" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "organizations_root_idx";`);
    this.addSql(`drop index if exists "organizations_parent_idx";`);
    this.addSql(`drop index if exists "organizations_tenant_depth_idx";`);
    this.addSql(`alter table "organizations" drop constraint "organizations_parent_id_foreign";`);

    this.addSql(`alter table "organizations" drop column "descendant_ids";`);
    this.addSql(`alter table "organizations" drop column "child_ids";`);
    this.addSql(`alter table "organizations" drop column "ancestor_ids";`);
    this.addSql(`alter table "organizations" drop column "depth";`);
    this.addSql(`alter table "organizations" drop column "tree_path";`);
    this.addSql(`alter table "organizations" drop column "root_id";`);
    this.addSql(`alter table "organizations" drop column "parent_id";`);
  }

}

