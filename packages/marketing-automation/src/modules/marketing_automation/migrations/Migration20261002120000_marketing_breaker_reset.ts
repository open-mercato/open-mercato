import { Migration } from '@mikro-orm/migrations'

/**
 * Lets an operator who fixed a deliverability problem actually restart the campaign.
 *
 * The breaker counts the failure rate over a fixed window, so re-enabling a paused campaign had it paused
 * again on the very next sweep — by the same failures the operator had just dealt with — and the only way out
 * was waiting the window out with nothing on screen saying so.
 *
 * Re-enabling is the statement that the cause is dealt with, so it moves this and the breaker counts from
 * whichever is later: the window's edge or this instant. Not `updated_at`, which moves on any edit: a
 * guardrail whose memory is cleared by an unrelated save stops guarding exactly while somebody is editing.
 *
 * Nullable with no backfill. Null means "never reset", which `coalesce(..., '-infinity')` reads as the window
 * alone — the behaviour every existing campaign already has.
 */
export class Migration20261002120000_marketing_breaker_reset extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "marketing_campaigns" add column "breaker_reset_at" timestamptz null;')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "marketing_campaigns" drop column "breaker_reset_at";')
  }
}
