import { Migration } from '@mikro-orm/migrations';

// Add `updated_at` to `users` and `roles` so user/role edits (and the ACL grants
// keyed off them) participate in OSS optimistic locking (#2055). The column is
// nullable to keep the migration online; existing rows are backfilled from
// `created_at` so they carry a version immediately instead of being unprotected
// until their first edit.
export class Migration20260601120000 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "users" add column if not exists "updated_at" timestamptz null;`);
    this.addSql(`update "users" set "updated_at" = "created_at" where "updated_at" is null;`);

    this.addSql(`alter table "roles" add column if not exists "updated_at" timestamptz null;`);
    this.addSql(`update "roles" set "updated_at" = "created_at" where "updated_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "users" drop column if exists "updated_at";`);
    this.addSql(`alter table "roles" drop column if exists "updated_at";`);
  }

}
