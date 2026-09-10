import { Migration } from '@mikro-orm/migrations';

export class Migration20260907120000_auth extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "user_sidebar_preferences" drop constraint "user_sidebar_preferences_user_id_foreign";`);
    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "sidebar_variants" drop constraint "sidebar_variants_user_id_foreign";`);
    this.addSql(`alter table "sidebar_variants" add constraint "sidebar_variants_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "user_sidebar_preferences" drop constraint "user_sidebar_preferences_user_id_foreign";`);
    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "sidebar_variants" drop constraint "sidebar_variants_user_id_foreign";`);
    this.addSql(`alter table "sidebar_variants" add constraint "sidebar_variants_user_id_foreign" foreign key ("user_id") references "users" ("id");`);
  }

}
