import { Migration } from '@mikro-orm/migrations'

export class Migration20260828234646_wms extends Migration {
  override up(): void {
    this.addSql(`
      create table "wms_acl_migration_20260828234646" (
        "role_acl_id" uuid not null,
        "previous_features_json" jsonb null,
        "previous_updated_at" timestamptz null,
        "created_by_migration" boolean not null,
        "applied_features_json" jsonb not null,
        "applied_updated_at" timestamptz not null,
        constraint "wms_acl_migration_20260828234646_pkey" primary key ("role_acl_id")
      );
    `)

    this.addSql(`
      insert into "wms_acl_migration_20260828234646" (
        "role_acl_id",
        "previous_features_json",
        "previous_updated_at",
        "created_by_migration",
        "applied_features_json",
        "applied_updated_at"
      )
      select
        ra."id",
        ra."features_json",
        ra."updated_at",
        false,
        case
          when ra."features_json" is null or jsonb_typeof(ra."features_json") <> 'array'
            then '["wms.manage_sites"]'::jsonb
          else ra."features_json" || '"wms.manage_sites"'::jsonb
        end,
        now()
      from "role_acls" as ra
      inner join "roles" as r on r."id" = ra."role_id"
        and r."tenant_id" = ra."tenant_id"
      where r."name" = 'supervisor'
        and r."deleted_at" is null
        and ra."deleted_at" is null
        and (
          ra."features_json" is null
          or jsonb_typeof(ra."features_json") <> 'array'
          or not (ra."features_json" ? 'wms.manage_sites')
        );
    `)

    this.addSql(`
      with inserted as (
        insert into "role_acls" (
          "role_id",
          "tenant_id",
          "features_json",
          "is_super_admin",
          "organizations_json",
          "created_at",
          "updated_at"
        )
        select
          r."id",
          r."tenant_id",
          '["wms.manage_sites"]'::jsonb,
          false,
          null,
          now(),
          now()
        from "roles" as r
        where r."name" = 'supervisor'
          and r."deleted_at" is null
          and not exists (
            select 1
            from "role_acls" as ra
            where ra."role_id" = r."id"
              and ra."tenant_id" = r."tenant_id"
              and ra."deleted_at" is null
          )
        returning "id", "features_json", "updated_at"
      )
      insert into "wms_acl_migration_20260828234646" (
        "role_acl_id",
        "previous_features_json",
        "previous_updated_at",
        "created_by_migration",
        "applied_features_json",
        "applied_updated_at"
      )
      select "id", null, null, true, "features_json", "updated_at"
      from inserted;
    `)

    this.addSql(`
      update "role_acls" as ra
      set
        "features_json" = case
          when ra."features_json" is null or jsonb_typeof(ra."features_json") <> 'array'
            then '["wms.manage_sites"]'::jsonb
          else ra."features_json" || '"wms.manage_sites"'::jsonb
        end,
        "updated_at" = backup."applied_updated_at"
      from "roles" as r, "wms_acl_migration_20260828234646" as backup
      where ra."role_id" = r."id"
        and ra."tenant_id" = r."tenant_id"
        and backup."role_acl_id" = ra."id"
        and ra."deleted_at" is null
        and r."deleted_at" is null
        and r."name" = 'supervisor'
        and (
          ra."features_json" is null
          or jsonb_typeof(ra."features_json") <> 'array'
          or not (ra."features_json" ? 'wms.manage_sites')
        );
    `)

    this.addSql(`drop table "wms_acl_migration_20260828234646";`)
  }
}
