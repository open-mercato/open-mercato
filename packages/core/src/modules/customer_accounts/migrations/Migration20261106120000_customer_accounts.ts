import { Migration } from '@mikro-orm/migrations';

export class Migration20261106120000_customer_accounts extends Migration {

  override name = 'Migration20261106120000';

  override async up(): Promise<void> {
    // Backfill (#8846): before this release `customer_roles.updated_at` had no
    // `onCreate` initializer, so every role created pre-fix still has a null
    // version. A null `current` makes `enforceCommandOptimisticLockWithGuards`
    // no-op (it cannot compare against "no version"), so these rows stay
    // unprotected from lost updates until touched. Stamp them with `created_at`
    // so every existing role is lockable immediately, without a spurious write
    // that would itself look like a concurrent edit to anyone already viewing it.
    this.addSql(`update "customer_roles" set "updated_at" = "created_at" where "updated_at" is null;`);
  }

  override async down(): Promise<void> {
    // Data-only backfill; no schema change to reverse, and re-nulling the
    // version would reintroduce the exact lost-update bug this migration fixes.
  }

}
