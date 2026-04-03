import { Migration } from '@mikro-orm/migrations';

export class Migration20260401172819 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_todo_links" alter column "todo_source" set default 'customers:interaction';`);
    this.addSql(`
      update "role_acls" as ra
      set
        "features_json" = case
          when ra."features_json" is null or jsonb_typeof(ra."features_json") <> 'array'
            then '["customers.interactions.view"]'::jsonb
          else ra."features_json" || '"customers.interactions.view"'::jsonb
        end,
        "updated_at" = now()
      where ra."deleted_at" is null
        and ra."features_json" is not null
        and jsonb_typeof(ra."features_json") = 'array'
        and ra."features_json" ? 'example.todos.view'
        and ra."features_json" ? 'customers.activities.view'
        and not (ra."features_json" ? 'customers.interactions.view');
    `);
    this.addSql(`
      update "user_acls" as ua
      set
        "features_json" = case
          when ua."features_json" is null or jsonb_typeof(ua."features_json") <> 'array'
            then '["customers.interactions.view"]'::jsonb
          else ua."features_json" || '"customers.interactions.view"'::jsonb
        end,
        "updated_at" = now()
      where ua."deleted_at" is null
        and ua."features_json" is not null
        and jsonb_typeof(ua."features_json") = 'array'
        and ua."features_json" ? 'example.todos.view'
        and ua."features_json" ? 'customers.activities.view'
        and not (ua."features_json" ? 'customers.interactions.view');
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_todo_links" alter column "todo_source" set default 'example:todo';`);
  }

}
