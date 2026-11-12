import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { createEnterpriseRotationProtection, type RotationCoordinatorOptions } from '../coordinator'
import type { VerificationRow } from '../canonical'
import { canonicalRotationTimestamp } from '../postgres-dataset'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'rotation-coordinator-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
function fixture() {
  const source = randomBytes(32).toString('base64'); const target = randomBytes(32).toString('base64'); const artifactKey = randomBytes(32).toString('base64')
  const state = { wrongBackup: false, wrongValue: false, fence: true, entitlement: true, mutated: false, reports: 0, creates: 0, timestamp: '2026-01-01 00:00:00.123456+00', verifiedBackup: false, refreshes: 0 }
  const providers = {
    provider: 'explicit-test-provider',
    kms: { isHealthy: () => true, async getTenantDek(tenantId: string) { return { tenantId, key: target, fetchedAt: Date.now() } }, async createTenantDek() { throw new Error('no provisioning') } },
    previousKms: { isHealthy: () => true, async getTenantDek(tenantId: string) { return { tenantId, key: source, fetchedAt: Date.now() } }, async createTenantDek() { throw new Error('no provisioning') } },
    async refresh() { state.refreshes++ },
  }
  const options: RotationCoordinatorOptions = {
    artifactRoot: join(directory, 'artifacts'), trustRoot: join(directory, 'trust'),
    async assertEntitlement() { if (!state.entitlement) throw new Error('entitlement unavailable') },
    providers: async () => providers,
    async dataset(_context, _providers, backupDigest, intents) { return {
      async assertFence() { if (!state.fence) throw new Error('fence lost') },
      async binding() { return { database: 'database', scope: 'tenant', schema: 'schema', coverage: 'all', provider: providers.provider, backupDigest } },
      async keys() { return { source, target, provider: providers.provider } },
      async *rows(phase) { yield { entity: 'public.custom_entities_storage', tenantId: 'tenant', organizationId: null, identity: ['row'], columns: [{ name: 'value', type: 'text', value: phase === 'after' && state.wrongValue ? 'corrupted' : 'original' }], metadata: { updated_at: canonicalRotationTimestamp(state.timestamp) }, ...(phase === 'after' ? { metadataIntent: await intents.load(JSON.stringify(['public.custom_entities_storage', 'tenant', null, ['row']])) } : {}) } satisfies VerificationRow },
    } },
    recovery: {
      async create() { state.creates++; return { artifactPath: '/fixture-backup', digest: 'a'.repeat(64), databaseBinding: state.wrongBackup ? 'other' : 'database', consistency: 'quiesced', encrypted: true } },
      async verify() { state.verifiedBackup = true },
    },
    async cipher() { return {
      async seal(bytes) { return Buffer.from(encryptWithAesGcm(Buffer.from(bytes).toString('base64'), artifactKey).raw) },
      async open(bytes) { const plaintext = decryptWithAesGcm(Buffer.from(bytes).toString(), artifactKey); if (plaintext === null) throw new Error('tampered'); return Buffer.from(plaintext, 'base64') },
    } },
    async report() { state.reports++ },
  }
  const context = { tenantId: 'tenant', organizationId: null, previousKey: 'source-root', dryRun: false, entityManager: {} as EntityManager }
  return { state, options, context }
}

test('does not mutate until backup verification and baseline preparation finish, and final scan gates report', async () => {
  const { state, options, context } = fixture()
  await createEnterpriseRotationProtection(options).protect(context, async () => {
    expect(state.verifiedBackup).toBe(true)
    const contents = await readdir(options.trustRoot)
    expect(contents.filter(name => name.endsWith('.json'))).toHaveLength(1)
    const record = JSON.parse(await readFile(join(options.trustRoot, contents.find(name => name.endsWith('.json'))!), 'utf8'))
    expect(record.status).toBe('rotating')
    state.mutated = true
  })
  expect(state.mutated).toBe(true); expect(state.reports).toBe(1); expect(state.refreshes).toBeGreaterThanOrEqual(2)
  expect((await readdir(options.trustRoot)).some(name => name.endsWith('.lock'))).toBe(false)
})

test('wrong-database recovery artifact refuses before mutation', async () => {
  const { state, options, context } = fixture(); state.wrongBackup = true
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => { state.mutated = true })).rejects.toThrow('BACKUP_DATABASE_MISMATCH')
  expect(state.mutated).toBe(false); expect(state.reports).toBe(0)
})

test('post-rotation mismatch retains a failed trusted record and cannot publish success', async () => {
  const { state, options, context } = fixture(); state.wrongValue = true
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => { state.mutated = true })).rejects.toThrow('DATA_MISMATCH')
  expect(state.reports).toBe(0)
  const record = (await readdir(options.trustRoot)).find(name => name.endsWith('.json'))!
  expect(JSON.parse(await readFile(join(options.trustRoot, record), 'utf8')).status).toBe('failed')
})

test('missing rights or fence cannot trigger backup or mutations', async () => {
  for (const gate of ['entitlement', 'fence'] as const) {
    const { state, options, context } = fixture(); state[gate] = false
    await expect(createEnterpriseRotationProtection(options).protect(context, async () => { state.mutated = true })).rejects.toThrow()
    expect(state.mutated).toBe(false); expect(state.verifiedBackup).toBe(false)
  }
})


test('authenticates timestamp transitions before writes and verifies exact full-precision baseline metadata', async () => {
  const { state, options, context } = fixture()
  await createEnterpriseRotationProtection(options).protect(context, async providers => {
    const timestamp = await providers!.timestampForWrite!({ table: 'custom_entities_storage', identity: 'row', tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp })
    state.timestamp = timestamp.toISOString()
  })
  expect(state.reports).toBe(1)
})

test('a failed verification resumes the original baseline and backup instead of making new expectations', async () => {
  const { state, options, context } = fixture()
  state.wrongValue = true
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => undefined)).rejects.toThrow('DATA_MISMATCH')
  const file = (await readdir(options.trustRoot)).find(name => name.endsWith('.json'))!
  const saved = JSON.parse(await readFile(join(options.trustRoot, file), 'utf8'))
  state.wrongValue = false
  await createEnterpriseRotationProtection({ ...options, resumeId: saved.id }).protect(context, async () => undefined)
  expect(state.creates).toBe(1); expect(state.reports).toBe(1)
  expect(JSON.parse(await readFile(join(options.trustRoot, file), 'utf8')).prepared).toEqual(saved.prepared)
})
