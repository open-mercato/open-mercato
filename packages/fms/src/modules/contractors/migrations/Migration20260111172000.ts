import { Migration } from '@mikro-orm/migrations';

export class Migration20260111172000_contractors extends Migration {

  override async up(): Promise<void> {
    // Add role_type_ids column to contractors table
    this.addSql(`alter table "contractors" add column "role_type_ids" jsonb null;`);

    // Migrate data from contractor_roles to the new column
    this.addSql(`
      update "contractors" c
      set "role_type_ids" = (
        select jsonb_agg(cr."role_type_id")
        from "contractor_roles" cr
        where cr."contractor_id" = c."id"
          and cr."is_active" = true
      )
      where exists (
        select 1 from "contractor_roles" cr
        where cr."contractor_id" = c."id"
          and cr."is_active" = true
      );
    `);

    // Drop foreign key constraints from contractor_roles
    this.addSql(`alter table "contractor_roles" drop constraint "contractor_roles_contractor_id_foreign";`);
    this.addSql(`alter table "contractor_roles" drop constraint "contractor_roles_role_type_id_foreign";`);

    // Drop contractor_roles table
    this.addSql(`drop table if exists "contractor_roles" cascade;`);

    // Remove the roles collection from contractor_role_types (no change needed in DB, just entity)
  }

  override async down(): Promise<void> {
    // Recreate contractor_roles table
    this.addSql(`create table "contractor_roles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "settings" jsonb null, "is_active" boolean not null default true, "effective_from" timestamptz null, "effective_to" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "contractor_id" uuid not null, "role_type_id" uuid not null, constraint "contractor_roles_pkey" primary key ("id"));`);
    this.addSql(`create index "idx_contractor_roles_role_type" on "contractor_roles" ("tenant_id", "organization_id", "role_type_id") where is_active = true;`);
    this.addSql(`create index "contractor_roles_contractor_idx" on "contractor_roles" ("contractor_id");`);
    this.addSql(`alter table "contractor_roles" add constraint "contractor_roles_unique" unique ("contractor_id", "role_type_id");`);
    this.addSql(`alter table "contractor_roles" add constraint "contractor_roles_contractor_id_foreign" foreign key ("contractor_id") references "contractors" ("id") on update cascade;`);
    this.addSql(`alter table "contractor_roles" add constraint "contractor_roles_role_type_id_foreign" foreign key ("role_type_id") references "contractor_role_types" ("id") on update cascade;`);

    // Migrate data back from role_type_ids to contractor_roles
    this.addSql(`
      insert into "contractor_roles" ("organization_id", "tenant_id", "contractor_id", "role_type_id", "is_active", "created_at", "updated_at")
      select c."organization_id", c."tenant_id", c."id", role_type_id::uuid, true, now(), now()
      from "contractors" c, jsonb_array_elements_text(c."role_type_ids") as role_type_id
      where c."role_type_ids" is not null;
    `);

    // Drop role_type_ids column
    this.addSql(`alter table "contractors" drop column "role_type_ids";`);
  }
}
