import { Migration } from '@mikro-orm/migrations';

// #2966: user_roles carries only its FK constraints and Postgres does not
// auto-index FK columns, so RBAC scans it sequentially by user_id on every
// ACL cache miss (rbacService super-admin check + ACL aggregation) and by
// role_id on user-list filtering and role rename/delete guards. Index both
// FK columns so these hot paths become index scans. The table is small
// relative to search_tokens, so a plain (transactional) build is safe.
export class Migration20260611103000 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create index if not exists "user_roles_user_id_idx" on "user_roles" ("user_id");`);
    this.addSql(`create index if not exists "user_roles_role_id_idx" on "user_roles" ("role_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "user_roles_user_id_idx";`);
    this.addSql(`drop index if exists "user_roles_role_id_idx";`);
  }

}
