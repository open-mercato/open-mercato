import { Migration } from '@mikro-orm/migrations';

// `user_acls` and `role_acls` decide what a principal may do, and neither had
// any uniqueness beyond its primary key. `RbacService.loadAcl` resolves the
// per-user row with a bare `findOne` and RETURNS EARLY on a hit — the per-user
// ACL replaces the role ACLs rather than merging with them — so two rows for
// the same `(user_id, tenant_id)` were schema-legal and resolved with no
// `ORDER BY`: whichever row Postgres happened to return decided the user's
// entire feature set, and could change between requests.
//
// The write path makes that reachable rather than theoretical:
// `auth.user_acl.update` reads with `findOne` and creates when it misses, so
// two concurrent saves for the same user both miss and both insert.
//
// Partial unique indexes scoped to live rows (`where deleted_at is null`),
// matching the shape already used for the sidebar tables in
// Migration20260427143311. A `@Unique` decorator cannot express a partial
// index, so the entities carry a comment pointing here instead.
//
// Historical duplicates are collapsed first — most recently updated row wins,
// the rest are soft-deleted, never dropped — so the indexes can be created on
// a database that already carries some.
export class Migration20260828120000_auth extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`
      with ranked as (
        select id,
               row_number() over (
                 partition by user_id, tenant_id
                 order by coalesce(updated_at, created_at) desc, created_at desc, id desc
               ) as rn
        from user_acls
        where deleted_at is null
      )
      update user_acls
      set deleted_at = now()
      from ranked
      where user_acls.id = ranked.id and ranked.rn > 1;
    `);
    this.addSql(`create unique index if not exists "user_acls_active_unique_idx" on "user_acls" ("user_id", "tenant_id") where "deleted_at" is null;`);

    this.addSql(`
      with ranked as (
        select id,
               row_number() over (
                 partition by role_id, tenant_id
                 order by coalesce(updated_at, created_at) desc, created_at desc, id desc
               ) as rn
        from role_acls
        where deleted_at is null
      )
      update role_acls
      set deleted_at = now()
      from ranked
      where role_acls.id = ranked.id and ranked.rn > 1;
    `);
    this.addSql(`create unique index if not exists "role_acls_active_unique_idx" on "role_acls" ("role_id", "tenant_id") where "deleted_at" is null;`);
  }

  override down(): void | Promise<void> {
    // Only the indexes are reversible. The collapse soft-deleted rows rather
    // than dropping them, so the data is still there to un-delete by hand if a
    // deployment ever needs it; un-deleting automatically would recreate the
    // ambiguity this migration exists to remove.
    this.addSql(`drop index if exists "user_acls_active_unique_idx";`);
    this.addSql(`drop index if exists "role_acls_active_unique_idx";`);
  }

}
