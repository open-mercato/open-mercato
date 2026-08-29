import { Migration } from '@mikro-orm/migrations'

export class Migration20260828234646_wms extends Migration {
  override up(): void {
    this.addSql(`
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
        );
    `)

    this.addSql(`
      update "role_acls" as ra
      set
        "features_json" = case
          when ra."features_json" is null or jsonb_typeof(ra."features_json") <> 'array'
            then '["wms.manage_sites"]'::jsonb
          else ra."features_json" || '"wms.manage_sites"'::jsonb
        end,
        "updated_at" = now()
      from "roles" as r
      where ra."role_id" = r."id"
        and ra."tenant_id" = r."tenant_id"
        and ra."deleted_at" is null
        and r."deleted_at" is null
        and r."name" = 'supervisor'
        and (
          ra."features_json" is null
          or jsonb_typeof(ra."features_json") <> 'array'
          or not (ra."features_json" ? 'wms.manage_sites')
        );
    `)
  }
}
