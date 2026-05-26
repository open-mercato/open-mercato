import { Migration } from '@mikro-orm/migrations';

// Cross-locale sidebar customization. Strip `locale` from uniqueness scope so the same
// variant/preference applies regardless of the user's active language. Soft-delete any
// historical duplicates first (keep the most-recently-updated row per scope) so the new
// constraints can be created without violations.
export class Migration20260427143311 extends Migration {

  override up(): void | Promise<void> {
    // --- sidebar_variants: collapse (user_id, tenant_id, name) across locales ---------
    this.addSql(`
      with ranked as (
        select id,
               row_number() over (
                 partition by user_id, tenant_id, name
                 order by coalesce(updated_at, created_at) desc, created_at desc, id desc
               ) as rn
        from sidebar_variants
        where deleted_at is null
      )
      update sidebar_variants
      set deleted_at = now()
      from ranked
      where sidebar_variants.id = ranked.id and ranked.rn > 1;
    `);
    this.addSql(`drop index if exists "sidebar_variants_active_name_unique_idx";`);
    this.addSql(`alter table "sidebar_variants" drop constraint if exists "sidebar_variants_user_id_tenant_id_locale_name_unique";`);
    this.addSql(`create unique index if not exists "sidebar_variants_active_name_unique_idx" on "sidebar_variants" ("user_id", "tenant_id", "name") where "deleted_at" is null;`);

    // --- user_sidebar_preferences: collapse (user_id, tenant_id, organization_id) -----
    this.addSql(`
      with ranked as (
        select id,
               row_number() over (
                 partition by user_id, tenant_id, organization_id
                 order by coalesce(updated_at, created_at) desc, created_at desc, id desc
               ) as rn
        from user_sidebar_preferences
        where deleted_at is null
      )
      update user_sidebar_preferences
      set deleted_at = now()
      from ranked
      where user_sidebar_preferences.id = ranked.id and ranked.rn > 1;
    `);
    this.addSql(`alter table "user_sidebar_preferences" drop constraint if exists "user_sidebar_preferences_user_id_tenant_id_organi_35248_unique";`);
    this.addSql(`alter table "user_sidebar_preferences" drop constraint if exists "user_sidebar_preferences_user_id_tenant_id_organi_f3f2f_unique";`);
    this.addSql(`drop index if exists "user_sidebar_preferences_active_unique_idx";`);
    this.addSql(`create unique index if not exists "user_sidebar_preferences_active_unique_idx" on "user_sidebar_preferences" ("user_id", "tenant_id", "organization_id") where "deleted_at" is null;`);

    // --- role_sidebar_preferences: collapse (role_id, tenant_id) ----------------------
    this.addSql(`
      with ranked as (
        select id,
               row_number() over (
                 partition by role_id, tenant_id
                 order by coalesce(updated_at, created_at) desc, created_at desc, id desc
               ) as rn
        from role_sidebar_preferences
        where deleted_at is null
      )
      update role_sidebar_preferences
      set deleted_at = now()
      from ranked
      where role_sidebar_preferences.id = ranked.id and ranked.rn > 1;
    `);
    this.addSql(`alter table "role_sidebar_preferences" drop constraint if exists "role_sidebar_preferences_role_id_tenant_id_locale_unique";`);
    this.addSql(`drop index if exists "role_sidebar_preferences_active_unique_idx";`);
    this.addSql(`create unique index if not exists "role_sidebar_preferences_active_unique_idx" on "role_sidebar_preferences" ("role_id", "tenant_id") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "sidebar_variants_active_name_unique_idx";`);
    this.addSql(`alter table "sidebar_variants" add constraint "sidebar_variants_user_id_tenant_id_locale_name_unique" unique ("user_id", "tenant_id", "locale", "name");`);

    this.addSql(`drop index if exists "user_sidebar_preferences_active_unique_idx";`);
    this.addSql(`alter table "user_sidebar_preferences" add constraint "user_sidebar_preferences_user_id_tenant_id_organi_35248_unique" unique ("user_id", "tenant_id", "organization_id", "locale");`);

    this.addSql(`drop index if exists "role_sidebar_preferences_active_unique_idx";`);
    this.addSql(`alter table "role_sidebar_preferences" add constraint "role_sidebar_preferences_role_id_tenant_id_locale_unique" unique ("role_id", "tenant_id", "locale");`);
  }

}
