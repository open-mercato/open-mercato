import { Migration } from '@mikro-orm/migrations';

/**
 * Idempotent backstop for `customer_person_company_links.deleted_at`.
 *
 * The column was originally added by `Migration20260415095203` and is
 * referenced by `Migration20260417140000`'s partial unique index
 * (`where "deleted_at" is null`). It is part of the committed
 * `migrations/.snapshot-open-mercato.json`.
 *
 * However, the runtime defensive probe that lived in
 * `packages/core/src/modules/customers/lib/personCompanyLinkTable.ts`
 * historically existed because an aborted-transaction state on a
 * shared connection could (very rarely) make `loadPersonCompanyLinks`
 * fail in a way that *looked* like the column was missing — and the
 * cached fallback then silently dropped the `deletedAt: null` filter.
 * That probe is removed in the same change as this migration (no
 * Kysely query is ever issued from inside an active MikroORM TX);
 * this migration is the matching belt-and-suspenders guarantee that
 * the column is physically present so the unconditional `deletedAt:
 * null` filter cannot 42703.
 *
 * Postgres-native `add column if not exists` is used so this re-applies
 * cleanly on already-migrated databases without raising.
 */
export class Migration20260521175027 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "customer_person_company_links" add column if not exists "deleted_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    // No-op on the way down: dropping the column would break
    // `Migration20260417140000`'s partial unique index, which is the
    // authoritative owner of the column going forward. The original
    // `Migration20260415095203` down still drops it for full rollback.
  }

}
