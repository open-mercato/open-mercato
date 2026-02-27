import { Migration } from '@mikro-orm/migrations';

export class Migration20260227120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      update "role_acls" as ra
      set
        "features_json" = case
          when ra."features_json" is null or jsonb_typeof(ra."features_json") <> 'array'
            then '["messages.view"]'::jsonb
          else ra."features_json" || '"messages.view"'::jsonb
        end,
        "updated_at" = now()
      from "roles" as r
      where ra."role_id" = r."id"
        and ra."deleted_at" is null
        and r."deleted_at" is null
        and r."name" in ('admin', 'employee')
        and (
          ra."features_json" is null
          or jsonb_typeof(ra."features_json") <> 'array'
          or not (ra."features_json" ? 'messages.view')
        );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      update "role_acls" as ra
      set
        "features_json" = coalesce(
          (
            select jsonb_agg(feature)
            from jsonb_array_elements_text(ra."features_json") as feature
            where feature <> 'messages.view'
          ),
          '[]'::jsonb
        ),
        "updated_at" = now()
      from "roles" as r
      where ra."role_id" = r."id"
        and ra."deleted_at" is null
        and r."deleted_at" is null
        and r."name" in ('admin', 'employee')
        and ra."features_json" is not null
        and jsonb_typeof(ra."features_json") = 'array'
        and ra."features_json" ? 'messages.view';
    `);
  }

}
