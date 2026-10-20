import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

// Seeds the change simulator encryption map for tenants created before it existed (maps are
// otherwise seeded only at tenant creation). Forward-only: deleting maps by entity id would also
// remove maps seeded at tenant creation or edited by administrators.
export class Migration20261010130100_insights extends Migration {

  override name = 'Migration20261010130100';

  override up(): void | Promise<void> {
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'insights:insights_simulation_run',
      fields: [{ field: 'input_json' }, { field: 'result_json' }],
    }));
  }

  override down(): void | Promise<void> {}

}
