import { describe, expect, jest, test } from '@jest/globals'
import { Migration20260930144604_marketing_automation } from '../Migration20260930144604_marketing_automation'

async function collectSql(): Promise<string[]> {
  const migration = Object.create(
    Migration20260930144604_marketing_automation.prototype,
  ) as Migration20260930144604_marketing_automation
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration.up()

  return statements
}

const TABLES = [
  'marketing_campaigns',
  'marketing_campaign_revisions',
  'marketing_campaign_runs',
  'marketing_campaign_triggers',
  'marketing_consents',
  'marketing_consent_events',
  'marketing_contact_preferences',
  'marketing_content_blocks',
  'marketing_customer_score_entries',
  'marketing_dispatch_dead_letters',
  'marketing_inbound_hooks',
  'marketing_job_runs',
  'marketing_message_sends',
  'marketing_message_send_events',
  'marketing_product_watches',
  'marketing_referral_codes',
  'marketing_referral_redemptions',
  'marketing_score_rules',
  'marketing_segments',
  'marketing_segment_snapshots',
  'marketing_subject_erasures',
  'marketing_survey_prompts',
  'marketing_value_boundaries',
]

describe('Migration20260930144604_marketing_automation', () => {
  test('creates exactly the 23 tables this phase owns, no more and no less', async () => {
    const statements = await collectSql()
    const createTableStatements = statements.filter((sql) => sql.startsWith('create table'))

    expect(createTableStatements).toHaveLength(TABLES.length)
    for (const table of TABLES) {
      expect(createTableStatements.some((sql) => sql.includes(`create table "${table}" (`))).toBe(true)
    }
  })

  test('pins the active-run and occurrence partial unique indexes exactly', async () => {
    const statements = await collectSql()

    // Guards re-entry: a subject cannot have two concurrently live runs for the same campaign.
    expect(statements).toContain(
      'create unique index "marketing_runs_active_subject_uniq" on "marketing_campaign_runs" '
      + '("tenant_id", "organization_id", "campaign_id", "subject_entity_id") '
      + "where subject_entity_id is not null and status in ('running', 'waiting', 'claimed');",
    )

    // Guards redelivered-event duplicate sends: the same occurrence can create at most one run.
    expect(statements).toContain(
      'create unique index "marketing_runs_occurrence_uniq" on "marketing_campaign_runs" '
      + '("tenant_id", "organization_id", "campaign_id", "occurrence_key") where occurrence_key is not null;',
    )
  })

  test('emits exactly 72 statements (23 creates plus their indexes/constraints)', async () => {
    const statements = await collectSql()
    expect(statements).toHaveLength(72)
  })
})
