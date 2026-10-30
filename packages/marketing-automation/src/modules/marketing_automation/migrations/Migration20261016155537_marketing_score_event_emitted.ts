import { Migration } from '@mikro-orm/migrations';

/**
 * Lets a retry tell "already scored, event still owed" apart from "already scored, event already out".
 *
 * The ledger write and the `score.changed` emission are two separate operations. A retry whose previous
 * attempt wrote the ledger row but failed to emit collided on `marketing_score_entry_step_uniq` and returned
 * without ever emitting — the points were correctly never double-awarded, but the one event a score-threshold
 * campaign was waiting for was lost for good. Null until the emission is confirmed, so the collision path can
 * decide whether to try again.
 */
export class Migration20261016155537_marketing_score_event_emitted extends Migration {

  override name = 'Migration20261016155537';

  override up(): void | Promise<void> {
    this.addSql(`alter table "marketing_customer_score_entries" add "event_emitted_at" timestamptz null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "marketing_customer_score_entries" drop column "event_emitted_at";`);
  }

}
