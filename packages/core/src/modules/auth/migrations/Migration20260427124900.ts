import { Migration } from '@mikro-orm/migrations';

// Replace the full unique constraint on sidebar_variants with a partial unique index
// scoped to live rows (deleted_at IS NULL). Without this, soft-deleting a variant and
// then trying to recreate one with the same name throws a duplicate-key error because
// the regular unique constraint considers tombstoned rows.
export class Migration20260427124900 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "sidebar_variants" drop constraint if exists "sidebar_variants_user_id_tenant_id_locale_name_unique";`);
    this.addSql(`create unique index if not exists "sidebar_variants_active_name_unique_idx" on "sidebar_variants" ("user_id", "tenant_id", "locale", "name") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "sidebar_variants_active_name_unique_idx";`);
    this.addSql(`alter table "sidebar_variants" add constraint "sidebar_variants_user_id_tenant_id_locale_name_unique" unique ("user_id", "tenant_id", "locale", "name");`);
  }

}
