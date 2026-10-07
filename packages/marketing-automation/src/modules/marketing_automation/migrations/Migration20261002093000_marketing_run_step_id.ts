import { Migration } from '@mikro-orm/migrations'

/**
 * Records WHICH step a parked run is waiting at, not just which position.
 *
 * `current_step_index` indexes into the flattened definition, and that flattening changes when an
 * author saves the graph, when an A/B test promotes its winner (the split is replaced by the winning
 * lane's steps), or when a step is reordered or deleted. A subject parked in lane B then resumed into
 * whatever now sits at that index — lane A's step at the same position — which is the variant mixture
 * the module forbids.
 *
 * A separate migration rather than a change to the initial one: that migration has been applied on
 * every tree carrying this branch, so editing it would leave those databases without the column and
 * no migration left to add it.
 *
 * Nullable with no backfill, deliberately. There is no correct value for a run that is ALREADY parked:
 * its index was resolved against a definition this migration cannot see, so inventing an id would be
 * the same guess the column exists to stop. Those runs keep resuming on the index, which is exactly
 * the old behaviour, and every run that parks after this reads its id.
 */
export class Migration20261002093000_marketing_run_step_id extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "marketing_campaign_runs" add column "current_step_id" text null;')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "marketing_campaign_runs" drop column "current_step_id";')
  }
}
