import { Migration } from '@mikro-orm/migrations';

export class Migration20260401172819 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_todo_links" alter column "todo_source" set default 'customers:interaction';`);
    this.addSql(`
      update "role_acls" as ra
      set
        "features_json" = case
          when ra."features_json" is null or jsonb_typeof(ra."features_json") <> 'array'
            then '["customers.interaction.view"]'::jsonb
          else ra."features_json" || '"customers.interaction.view"'::jsonb
        end,
        "updated_at" = now()
      where ra."deleted_at" is null
        and ra."features_json" is not null
        and jsonb_typeof(ra."features_json") = 'array'
        and ra."features_json" ? 'example.todo.view'
        and ra."features_json" ? 'customers.activity.view'
        and not (ra."features_json" ? 'customers.interaction.view');
    `);
    this.addSql(`
      update "user_acls" as ua
      set
        "features_json" = case
          when ua."features_json" is null or jsonb_typeof(ua."features_json") <> 'array'
            then '["customers.interaction.view"]'::jsonb
          else ua."features_json" || '"customers.interaction.view"'::jsonb
        end,
        "updated_at" = now()
      where ua."deleted_at" is null
        and ua."features_json" is not null
        and jsonb_typeof(ua."features_json") = 'array'
        and ua."features_json" ? 'example.todo.view'
        and ua."features_json" ? 'customers.activity.view'
        and not (ua."features_json" ? 'customers.interaction.view');
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_todo_links" alter column "todo_source" set default 'example:todo';`);
  }

}
