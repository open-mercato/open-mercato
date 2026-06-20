import { Migration } from '@mikro-orm/migrations';

// #2934: User email uniqueness must be per-tenant, not global. The original
// `users_email_unique` constraint (unique on `email` across all tenants) contradicts the
// multi-tenant login flow — which resolves the same email across tenants via
// `findUsersByEmail` — and leaks cross-tenant account existence / enables registration
// squatting. Replace it with a partial unique index scoped per-tenant over live rows.
//
// The index is keyed on `email_hash`, NOT `email`: `email` is encrypted at rest with a
// per-row IV (auth/encryption.ts -> shared aes.ts), so its ciphertext is non-deterministic
// and a unique index on it would never detect duplicates under the default (encryption-on)
// configuration. `email_hash` is the deterministic lookup hash the application already
// de-dupes on, so the constraint is effective in both encryption-on and encryption-off
// modes. This mirrors `customer_users_tenant_email_hash_uniq` in customer_accounts.
//
// `WHERE deleted_at IS NULL` lets a soft-deleted user's email be reused (the old non-partial
// constraint blocked this); `AND email_hash IS NOT NULL` skips the rare legacy/bootstrap rows
// that predate hash population (encryption-off `setup-app` users) — those remain protected by
// the tenant-scoped application duplicate check.
//
// Before creating the index, soft-delete any pre-existing duplicate live rows per
// (tenant_id, email_hash), keeping the most-recently-updated one. Under encryption the old
// `email` constraint never fired, so same-tenant duplicates were only blocked by the
// application check and a historical race could have slipped one through; the dedupe makes
// the index creation safe on such data (no-op when there are none).
export class Migration20260610120000 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`
      with ranked as (
        select id,
               row_number() over (
                 partition by tenant_id, email_hash
                 order by coalesce(updated_at, created_at) desc, created_at desc, id desc
               ) as rn
        from users
        where deleted_at is null and email_hash is not null
      )
      update users
      set deleted_at = now()
      from ranked
      where users.id = ranked.id and ranked.rn > 1;
    `);
    this.addSql(`alter table "users" drop constraint if exists "users_email_unique";`);
    this.addSql(`create unique index if not exists "users_tenant_email_hash_uniq" on "users" ("tenant_id", "email_hash") where "deleted_at" is null and "email_hash" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "users_tenant_email_hash_uniq";`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);
  }

}
