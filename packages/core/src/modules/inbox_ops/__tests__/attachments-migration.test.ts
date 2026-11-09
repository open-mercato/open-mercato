/** @jest-environment node */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill'
import { defaultEncryptionMaps } from '../encryption'
import { Migration20261108130000_inbox_ops as InboundAttachmentsMigration } from '../migrations/Migration20261108130000_inbox_ops'

const PARTIAL_INDEX = 'create index "inbox_emails_attachments_release_pending_idx" on "inbox_emails" ("tenant_id", "organization_id") where deleted_at is not null and attachments_released_at is null and (attachments_status is not null or attachments_release_requested_at is not null)'

const ATTACHMENT_MAP = {
  entityId: 'inbox_ops:inbox_email_attachment',
  fields: [{ field: 'file_name' }, { field: 'extracted_text' }],
}
const ACTION_MAP = {
  entityId: 'inbox_ops:inbox_proposal_action',
  fields: [{ field: 'description' }, { field: 'payload' }, { field: 'execution_error' }, { field: 'source_refs' }],
}
/** The action backfill lists only the rule this migration adds; older rules an admin removed stay removed. */
const ACTION_BACKFILL = {
  entityId: ACTION_MAP.entityId,
  fields: [{ field: 'source_refs' }],
}

type SnapshotTable = {
  name: string
  columns: Record<string, { type: string; nullable: boolean; default: string | null }>
  indexes: Array<{ keyName: string; columnNames: string[]; unique: boolean; expression?: string }>
}

async function collect(direction: 'up' | 'down'): Promise<string[]> {
  const migration = new InboundAttachmentsMigration(undefined as never, undefined as never)
  await migration[direction]()
  return migration.getQueries().map((query) => String(query))
}

function snapshotTable(name: string): SnapshotTable {
  const snapshot = JSON.parse(
    readFileSync(join(__dirname, '..', 'migrations', '.snapshot-open-mercato.json'), 'utf8'),
  ) as { tables: SnapshotTable[] }
  const table = snapshot.tables.find((entry) => entry.name === name)
  expect(table).toBeDefined()
  return table!
}

describe('Migration20261108130000_inbox_ops (inbound attachments)', () => {
  it('creates the ledger table with its unique part key and scoped index', async () => {
    const sql = (await collect('up')).join('\n')
    expect(sql).toContain('create table "inbox_email_attachments"')
    for (const column of [
      '"inbox_email_id" uuid not null', '"part_key" text not null', '"file_name" text null', '"declared_mime_type" text null',
      '"mime_type" text null', '"size_bytes" int null', '"content_id" text null', '"attempts" int not null default 0',
      '"in_flight_at" timestamptz null', '"disposition" text not null', '"status" text not null', '"reason" text null',
      '"attachment_id" uuid null', '"extracted_text" text null', '"organization_id" uuid not null', '"tenant_id" uuid not null',
      '"created_at" timestamptz not null', '"updated_at" timestamptz not null', '"deleted_at" timestamptz null',
    ]) {
      expect(sql).toContain(column)
    }
    expect(sql).toContain('add constraint "inbox_email_attachments_email_part_key_unique" unique ("inbox_email_id", "part_key")')
    expect(sql).toContain('create index "inbox_email_attachments_scope_email_idx" on "inbox_email_attachments" ("organization_id", "tenant_id", "inbox_email_id")')
  })

  it('adds only nullable inbox_emails columns, the generation counters defaulting to 0', async () => {
    const sql = (await collect('up')).join('\n')
    for (const column of [
      '"attachments_status" text null', '"attachments_claim_token" uuid null', '"attachments_claimed_at" timestamptz null',
      '"attachments_first_failure_at" timestamptz null', '"attachments_release_requested_at" timestamptz null',
      '"attachments_released_at" timestamptz null', '"attachments_ingest_generation" int null default 0',
      '"attachments_current_generation" int null default 0', '"attachments_next_run_at" timestamptz null',
    ]) {
      expect(sql).toContain(`add column ${column}`)
    }
    expect(sql).not.toMatch(/alter table "inbox_emails"[^;]*not null/)
    expect(sql).toContain('alter table "inbox_proposal_actions" add column "source_refs" jsonb null;')
  })

  it('creates the stranded-email indexes and the partial deny-set index declared on the entity and snapshot', async () => {
    const sql = (await collect('up')).join('\n')
    expect(sql).toContain('create index "inbox_emails_attachments_status_attachments_next_run_at_index" on "inbox_emails" ("attachments_status", "attachments_next_run_at")')
    expect(sql).toContain('create index "inbox_emails_attachments_status_attachments_claimed_at_index" on "inbox_emails" ("attachments_status", "attachments_claimed_at")')
    expect(sql).toContain(`${PARTIAL_INDEX};`)

    const entities = readFileSync(join(__dirname, '..', 'data', 'entities.ts'), 'utf8')
    expect(entities).toContain(PARTIAL_INDEX)
    const emails = snapshotTable('inbox_emails')
    expect(emails.indexes.find((index) => index.keyName === 'inbox_emails_attachments_release_pending_idx')?.expression).toBe(PARTIAL_INDEX)
    expect(emails.columns.attachments_ingest_generation).toMatchObject({ type: 'int', nullable: true, default: '0' })
    expect(snapshotTable('inbox_proposal_actions').columns.source_refs).toMatchObject({ type: 'jsonb', nullable: true })
    const ledger = snapshotTable('inbox_email_attachments')
    expect(ledger.indexes.find((index) => index.keyName === 'inbox_email_attachments_email_part_key_unique'))
      .toMatchObject({ columnNames: ['inbox_email_id', 'part_key'], unique: true })
  })

  it('backfills both encryption maps for tenants created before the migration', async () => {
    const queries = await collect('up')
    // Tenants existing before this migration have no map row for the ledger and an action map
    // without `source_refs`; without these statements `encryptEntityPayload` would find no rule
    // and store the new columns as plaintext.
    expect(queries).toContain(buildEncryptionMapBackfillSql(ATTACHMENT_MAP))
    expect(queries).toContain(buildEncryptionMapBackfillSql(ACTION_BACKFILL))
    const backfill = buildEncryptionMapBackfillSql(ATTACHMENT_MAP)
    expect(backfill).toContain(`'inbox_ops:inbox_email_attachment', src."tenant_id", src."organization_id", '[{"field":"file_name"},{"field":"extracted_text"}]'::jsonb`)
    expect(buildEncryptionMapBackfillSql(ACTION_BACKFILL)).toContain(`|| '[{"field":"source_refs"}]'::jsonb`)
  })

  it('never re-adds the proposal-action rules that predate this migration', async () => {
    const sql = (await collect('up')).join('\n')
    for (const field of ['description', 'payload', 'execution_error']) {
      expect(sql).not.toContain(`{"field":"${field}"}`)
    }
  })

  it('backfills exactly the fields the module map encrypts, and only the action rule it adds', () => {
    const byEntity = (entityId: string) => defaultEncryptionMaps.find((map) => map.entityId === entityId)?.fields
    expect(byEntity(ATTACHMENT_MAP.entityId)).toEqual(ATTACHMENT_MAP.fields)
    expect(byEntity(ACTION_MAP.entityId)).toEqual(ACTION_MAP.fields)
    expect(ACTION_MAP.fields).toEqual(expect.arrayContaining(ACTION_BACKFILL.fields))
  })

  it('keeps the backfill forward-only and reverts the schema', async () => {
    const sql = (await collect('down')).join('\n')
    expect(sql).not.toContain('encryption_maps')
    expect(sql).toContain('drop table if exists "inbox_email_attachments"')
    expect(sql).toContain('drop column if exists "source_refs"')
    expect(sql).toContain('drop index if exists "inbox_emails_attachments_release_pending_idx"')
  })
})
