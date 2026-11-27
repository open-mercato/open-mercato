import { Migration } from '@mikro-orm/migrations'

/**
 * Moves the trigger payload out of the run's queryable jsonb and into a column that can be encrypted.
 *
 * An inbound hook copies every key a partner posted into the trigger context — `readInboundPayload` does not
 * filter — so a first name, a phone number and an address were being stored in plaintext jsonb that the runs
 * API returns and every replica carries. Core encrypts the equivalent customer comment; this module had no
 * `encryption.ts` at all.
 *
 * Encrypting `context` whole was the obvious move and does not work: the erasure finds a person's runs with
 * `context ->> 'subjectEntityId'`, and ciphertext cannot answer that. So the free-form half moves to its own
 * column and the queryable half stays queryable. Above the database nothing changes shape —
 * `lib/run-context.ts` splits on write and merges on read, so the engine still sees one `AutomationContext`
 * with `trigger` on it and `{{trigger.*}}` keeps resolving in authored copy.
 *
 * The backfill moves existing payloads across and REMOVES the jsonb key, so the plaintext copy does not
 * linger beside the column that replaced it — the point of the change is that it stops being there. Rows
 * land in the new column as plaintext and are encrypted by the platform the next time they are written,
 * which is the ordinary path for a newly declared encrypted field.
 */
export class Migration20261002110000_marketing_trigger_context extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "marketing_campaign_runs" add column "trigger_context" json null;')
    this.addSql(`
      update "marketing_campaign_runs"
         set "trigger_context" = "context" -> 'trigger'
       where jsonb_typeof("context" -> 'trigger') = 'object'
         and "context" -> 'trigger' <> '{}'::jsonb;
    `)
    this.addSql(`update "marketing_campaign_runs" set "context" = "context" - 'trigger';`)
  }

  override async down(): Promise<void> {
    this.addSql(`
      update "marketing_campaign_runs"
         set "context" = "context" || jsonb_build_object('trigger', coalesce("trigger_context"::jsonb, '{}'::jsonb))
       where "trigger_context" is not null;
    `)
    this.addSql('alter table "marketing_campaign_runs" drop column "trigger_context";')
  }
}
