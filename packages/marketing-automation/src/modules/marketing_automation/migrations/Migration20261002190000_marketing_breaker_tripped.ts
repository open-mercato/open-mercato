import { Migration } from '@mikro-orm/migrations'

/**
 * Lets an operator tell an automatic pause from one somebody chose.
 *
 * The deliverability breaker switched campaigns off through the ordinary `set_enabled` command, recording
 * nothing about why — so the screen showed a plain off toggle, identical to a manual pause. The obvious action
 * on an off toggle is to switch it back on, and the breaker undid that on the next sweep: an operator could
 * fight their own guardrail without ever being told it was there.
 *
 * Nullable with no backfill. Null means "not paused by the breaker", which is the state every existing campaign
 * is in as far as anybody can now establish — inventing a value for the ones it paused in the past would be
 * guessing, and a wrong "paused automatically" badge is worse than none.
 */
export class Migration20261002190000_marketing_breaker_tripped extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "marketing_campaigns" add column "breaker_tripped_at" timestamptz null;')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "marketing_campaigns" drop column "breaker_tripped_at";')
  }
}
