import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { decryptWithAesGcm, encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import { Migration20261115120000_mfa_removal_audit_redaction } from '../Migration20261115120000_mfa_removal_audit_redaction'

const postgresUrl = process.env.OM_SECURITY_MIGRATION_PG_URL
const describePostgres = postgresUrl ? describe : describe.skip
const commandId = 'security.mfa.method.remove'

async function runMigration(client: PoolClient, direction: 'up' | 'down' = 'up'): Promise<void> {
  const migration = Object.create(
    Migration20261115120000_mfa_removal_audit_redaction.prototype,
  ) as Migration20261115120000_mfa_removal_audit_redaction
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: (statement: string) => statements.push(statement),
  })
  await migration[direction]()
  for (const statement of statements) await client.query(statement)
}

describePostgres('MFA removal audit redaction against PostgreSQL', () => {
  let pool: Pool
  let client: PoolClient

  beforeAll(() => {
    pool = new Pool({ connectionString: postgresUrl, connectionTimeoutMillis: 5000 })
  })

  beforeEach(async () => {
    client = await pool.connect()
    await client.query('BEGIN')
    const schema = `mfa_audit_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET LOCAL search_path TO "${schema}"`)
  })

  afterEach(async () => {
    await client.query('ROLLBACK')
    client.release()
  })

  afterAll(async () => {
    await pool.end()
  })

  async function createAuditTable(): Promise<void> {
    await client.query(`CREATE TABLE action_logs (
      id text PRIMARY KEY, tenant_id text, command_id text NOT NULL, resource_kind text,
      snapshot_before jsonb, snapshot_after jsonb, command_payload jsonb,
      changes_json jsonb, undo_token text, deleted_at timestamptz
    )`)
  }

  async function insertLog(id: string, options: {
    tenantId?: string
    command?: string
    resourceKind?: string
    snapshot?: unknown
    payload?: unknown
    changes?: unknown
    deletedAt?: Date | null
  } = {}): Promise<void> {
    const snapshot = options.snapshot === undefined
      ? { id: 'method-1', type: 'totp', label: 'Phone', secret: 'private-seed', providerMetadata: { key: 'private-key' } }
      : options.snapshot
    const payload = options.payload === undefined
      ? { methodType: 'totp', undo: { before: snapshot, after: snapshot }, __redoInput: { id: 'method-1' } }
      : options.payload
    const changes = options.changes === undefined
      ? { secret: { from: 'private-seed', to: null }, providerMetadata: { from: { key: 'private-key' }, to: null }, isActive: { from: true, to: false } }
      : options.changes
    await client.query(`INSERT INTO action_logs
      (id, tenant_id, command_id, snapshot_before, snapshot_after, command_payload, changes_json, undo_token, deleted_at, resource_kind)
      VALUES ($1, $2, $3, $4::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, 'legacy-token', $7, $8)`,
    [id, options.tenantId ?? 'tenant-1', options.command ?? commandId,
      JSON.stringify(snapshot), JSON.stringify(payload), JSON.stringify(changes), options.deletedAt ?? null,
      options.resourceKind ?? (options.command && options.command !== commandId ? 'example.entity' : 'security.mfa_method')])
  }

  test('scrubs every persisted credential copy across tenants, deleted rows and undo traces', async () => {
    await createAuditTable()
    await insertLog('tenant-a')
    await insertLog('tenant-b', { tenantId: 'tenant-2', deletedAt: new Date() })
    await insertLog('undo-trace', { payload: null })
    await runMigration(client)

    const { rows } = await client.query<Record<string, unknown>>('SELECT * FROM action_logs ORDER BY id')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.snapshot_before).toEqual({ id: 'method-1', type: 'totp', label: 'Phone' })
      expect(row.snapshot_after).toEqual(row.snapshot_before)
      expect(row.changes_json).toEqual({ isActive: { from: true, to: false } })
      expect(row.undo_token).toBeNull()
      expect(JSON.stringify(row)).not.toContain('private-seed')
      expect(JSON.stringify(row)).not.toContain('private-key')
      expect(row.command_payload).toEqual(row.id === 'undo-trace' ? null : { methodType: 'totp' })
    }
    expect(rows.find((row) => row.id === 'tenant-b')?.tenant_id).toBe('tenant-2')
    expect(rows.find((row) => row.id === 'tenant-b')?.deleted_at).toBeInstanceOf(Date)
  })

  test('preserves unrelated command history byte-for-byte', async () => {
    await createAuditTable()
    await insertLog('unrelated', { command: 'example.command' })
    await insertLog('unrelated-same-resource', { command: 'example.command', resourceKind: 'security.mfa_method' })
    const before = await client.query('SELECT * FROM action_logs ORDER BY id')
    await runMigration(client)
    expect((await client.query('SELECT * FROM action_logs ORDER BY id')).rows).toEqual(before.rows)
  })

  test.each([
    { encryptedCommand: true, encryptedJson: true },
    { encryptedCommand: true, encryptedJson: false },
    { encryptedCommand: false, encryptedJson: true },
  ])('redacts encrypted and mixed MFA history: %j', async ({ encryptedCommand, encryptedJson }) => {
    await createAuditTable()
    const key = generateDek()
    const sealedCommand = encryptWithAesGcm(commandId, key).raw
    const snapshot = { id: 'method-1', secret: 'private-seed', providerMetadata: { key: 'private-key' } }
    const payload = { methodType: 'totp', undo: { before: snapshot, after: snapshot }, __redoInput: { id: 'method-1' } }
    const changes = { secret: { from: 'private-seed', to: null }, providerMetadata: { from: 'private-key', to: null } }
    expect(decryptWithAesGcm(sealedCommand, key)).toBe(commandId)

    for (const [index, id] of ['removed', 'deleted', 'undo-trace'].entries()) {
      await insertLog(id, {
        tenantId: `tenant-${index}`,
        command: encryptedCommand ? sealedCommand : commandId,
        resourceKind: 'security.mfa_method',
        snapshot: encryptedJson ? encryptWithAesGcm(JSON.stringify(snapshot), key).raw : snapshot,
        payload: id === 'undo-trace' ? null : encryptedJson ? encryptWithAesGcm(JSON.stringify(payload), key).raw : payload,
        changes: encryptedJson ? encryptWithAesGcm(JSON.stringify(changes), key).raw : changes,
        deletedAt: id === 'deleted' ? new Date() : null,
      })
    }
    await insertLog('unrelated-encrypted', {
      command: encryptWithAesGcm('example.command', key).raw,
      resourceKind: 'example.entity',
      snapshot: encryptWithAesGcm(JSON.stringify(snapshot), key).raw,
      payload: encryptWithAesGcm(JSON.stringify(payload), key).raw,
      changes: encryptWithAesGcm(JSON.stringify(changes), key).raw,
    })
    const unrelatedBefore = await client.query('SELECT * FROM action_logs WHERE id = $1', ['unrelated-encrypted'])

    await runMigration(client)
    await runMigration(client)
    const { rows } = await client.query<Record<string, unknown>>('SELECT * FROM action_logs WHERE id <> $1', ['unrelated-encrypted'])
    for (const row of rows) {
      expect(row.command_id).toBe(encryptedCommand ? sealedCommand : commandId)
      expect(row.resource_kind).toBe('security.mfa_method')
      expect(row.undo_token).toBeNull()
      expect(row.snapshot_before).toEqual(encryptedJson ? null : { id: 'method-1' })
      expect(row.snapshot_after).toEqual(row.snapshot_before)
      expect(row.command_payload).toEqual(encryptedJson || row.id === 'undo-trace' ? null : { methodType: 'totp' })
      expect(row.changes_json).toEqual(encryptedJson ? null : {})
    }
    expect((await client.query('SELECT * FROM action_logs WHERE id = $1', ['unrelated-encrypted'])).rows)
      .toEqual(unrelatedBefore.rows)
  })

  test.each([
    { value: null },
    { value: 'malformed' },
    { value: 42 },
    { value: [] },
    { value: {} },
  ])('handles null and malformed JSON values: $value', async ({ value }) => {
    await createAuditTable()
    await insertLog('partial', { snapshot: value, payload: value, changes: value })
    await runMigration(client)
    const { rows } = await client.query('SELECT * FROM action_logs')
    expect(rows[0].undo_token).toBeNull()
    for (const column of ['snapshot_before', 'snapshot_after', 'command_payload', 'changes_json']) {
      expect(rows[0][column]).toEqual(value !== null && typeof value === 'object' && !Array.isArray(value) ? {} : null)
    }
  })

  test('is idempotent and rollback cannot restore purged credentials', async () => {
    await createAuditTable()
    await insertLog('legacy')
    await runMigration(client)
    const before = await client.query('SELECT * FROM action_logs')
    await runMigration(client)
    await runMigration(client, 'down')
    expect((await client.query('SELECT * FROM action_logs')).rows).toEqual(before.rows)
  })

  test('works when audit logs are not installed', async () => {
    await expect(runMigration(client)).resolves.toBeUndefined()
  })
})
