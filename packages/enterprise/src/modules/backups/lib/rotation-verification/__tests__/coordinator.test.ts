import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { publishRotationReport } from '../report'
import { createEnterpriseRotationProtection, type RotationCoordinatorOptions } from '../coordinator'
import type { VerificationRow } from '../canonical'
import { canonicalRotationTimestamp } from '../postgres-dataset'
import { RotationArtifactStore } from '../store'

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
  const phases: string[] = []
  options.phase = phase => { phases.push(phase) }
  await createEnterpriseRotationProtection(options).protect(context, async () => {
    expect(phases).toEqual(['recovery', 'recovery-verification', 'baseline', 'rotating'])
    expect(state.verifiedBackup).toBe(true)
    const contents = await readdir(options.trustRoot)
    expect(contents.filter(name => name.endsWith('.json'))).toHaveLength(1)
    const record = JSON.parse(await readFile(join(options.trustRoot, contents.find(name => name.endsWith('.json'))!), 'utf8'))
    expect(record.status).toBe('rotating')
    state.mutated = true
  })
  expect(state.mutated).toBe(true); expect(state.reports).toBe(1); expect(state.refreshes).toBeGreaterThanOrEqual(2)
  expect((await readdir(options.trustRoot)).some(name => name.endsWith('.lock'))).toBe(false)
  expect(phases).toEqual(['recovery', 'recovery-verification', 'baseline', 'rotating', 'verification', 'finalizing'])
  const record = (await readdir(options.trustRoot)).find(name => name.endsWith('.json'))!
  expect(JSON.parse(await readFile(join(options.trustRoot, record), 'utf8')).status).toBe('passed')
})

test('wrong-database recovery artifact refuses before mutation', async () => {
  const { state, options, context } = fixture(); state.wrongBackup = true
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => { state.mutated = true })).rejects.toThrow('BACKUP_DATABASE_MISMATCH')
  expect(state.mutated).toBe(false); expect(state.reports).toBe(0)
})

test('absence of both a derived root and an actual previous KMS never permits mutation', async () => {
  const { state, options, context } = fixture()
  const original = options.providers
  options.providers = async input => ({ ...await original(input), previousKms: null })
  await expect(createEnterpriseRotationProtection(options).protect({ ...context, previousKey: null }, async () => { state.mutated = true })).rejects.toThrow('ROTATION_SOURCE_KEY_REQUIRED')
  expect(state.mutated).toBe(false)
  expect(state.creates).toBe(0)
  expect(state.reports).toBe(0)
})

test('a provider change during report publication prevents durable completion even after a verified receipt', async () => {
  const { state, options, context } = fixture()
  const original = options.providers
  options.providers = async input => {
    const providers = await original(input)
    return { ...providers, async refresh() {
      await providers.refresh()
      if (state.reports) throw new Error('[internal] ROTATION_VAULT_TARGET_NOT_CURRENT')
    } }
  }
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => { state.mutated = true })).rejects.toThrow('ROTATION_VAULT_TARGET_NOT_CURRENT')
  expect(state.reports).toBe(1)
  const record = (await readdir(options.trustRoot)).find(name => name.endsWith('.json'))!
  expect(JSON.parse(await readFile(join(options.trustRoot, record), 'utf8')).status).toBe('failed')
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


test('a durable report followed by failed trusted-state publication resumes idempotently', async () => {
  const { options, context } = fixture()
  let failedOnce = false
  options.report = async (result, recovery) => {
    await publishRotationReport(join(options.trustRoot, `${result.runId}.report.json`), result, recovery)
    if (!failedOnce) { failedOnce = true; throw new Error('injected failure after durable receipt') }
  }
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => {})).rejects.toThrow('durable receipt')
  const records = (await readdir(options.trustRoot)).filter((name) => name.endsWith('.json') && !name.endsWith('.report.json'))
  expect(records).toHaveLength(1)
  const id = records[0]!.slice(0, -5)
  await expect(createEnterpriseRotationProtection({ ...options, resumeId: id }).protect(context, async () => {})).resolves.toBeUndefined()
  expect(JSON.parse(await readFile(join(options.trustRoot, records[0]!), 'utf8')).status).toBe('passed')
})


test('durable timestamp pages use one encryption per batch and preserve intent on repeated batches', async () => {
  const { options, context, state } = fixture()
  const cipher = await options.cipher(); const seal = jest.spyOn(cipher, 'seal')
  options.cipher = async () => cipher
  await createEnterpriseRotationProtection(options).protect(context, async providers => {
    const intent = (identity: string) => ({ table: 'custom_entities_storage', identity, tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp })
    const before = seal.mock.calls.length
    const dates = await providers!.timestampForBatchWrite!([intent('other-a'), intent('other-b')])
    expect(seal.mock.calls.length - before).toBe(1)
    expect(dates).toHaveLength(2)
    const repeated = await providers!.timestampForBatchWrite!([intent('other-a'), intent('other-b')])
    expect(repeated).toEqual(dates)
    expect(seal.mock.calls.length - before).toBe(1)
    await providers!.timestampForBatchWrite!([intent('other-c'), intent('other-d')])
    expect(seal.mock.calls.length - before).toBe(2)
    await expect(providers!.timestampForBatchWrite!([{ ...intent('other-a'), previousTimestamp: '2000-01-01 00:00:00+00' }])).rejects.toThrow('METADATA_MISMATCH')
  }).catch(error => { expect(String(error)).toContain('METADATA_MISMATCH') })
  const roots = await readdir(options.artifactRoot)
  const files = (await readdir(join(options.artifactRoot, roots[0]!))).filter(name => name.startsWith('intent-'))
  expect(files).toHaveLength(6) // two pages, each with two row-address hardlinks
  const inodes = await Promise.all(files.map(async file => (await stat(join(options.artifactRoot, roots[0]!, file))).ino))
  expect(new Set(inodes).size).toBe(2)
  expect(state.reports).toBe(0)
})

test('fresh timestamp metadata checks are bounded to eight and join their group before a permission failure', async () => {
  const { options, context, state } = fixture()
  const original = RotationArtifactStore.prototype.fileIdentity
  let armed = false, active = 0, peak = 0, completed = 0, started = 0
  const metadata = jest.spyOn(RotationArtifactStore.prototype, 'fileIdentity').mockImplementation(async function (this: RotationArtifactStore, name) {
    if (!armed || !name.startsWith('intent-')) return original.call(this, name)
    const index = started++; active++; peak = Math.max(peak, active)
    try {
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 1 : 5))
      if (index === 0) throw Object.assign(new Error('[internal] fixture metadata EACCES'), { code: 'EACCES' })
      return await original.call(this, name)
    } finally { active--; completed++ }
  })
  try {
    await expect(createEnterpriseRotationProtection(options).protect(context, async providers => {
      armed = true
      await providers!.timestampForBatchWrite!(Array.from({ length: 20 }, (_, index) => ({ table: 'custom_entities_storage', identity: `fresh-${index}`, tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp })))
      state.mutated = true
    })).rejects.toThrow('fixture metadata EACCES')
    expect(peak).toBe(8); expect(started).toBe(8); expect(completed).toBe(8); expect(active).toBe(0)
    expect(state.mutated).toBe(false); expect(state.reports).toBe(0)
  } finally { metadata.mockRestore() }
})

test('cached timestamp records win over deleted aliases without another metadata check or page', async () => {
  const { options, context, state } = fixture()
  const cipher = await options.cipher(); const seal = jest.spyOn(cipher, 'seal'); options.cipher = async () => cipher
  const aliases: string[] = []
  const originalLink = RotationArtifactStore.prototype.linkNames
  const linking = jest.spyOn(RotationArtifactStore.prototype, 'linkNames').mockImplementation(async function (this: RotationArtifactStore, source, names) {
    aliases.push(...names); return originalLink.call(this, source, names)
  })
  let metadata: jest.SpyInstance | undefined
  try {
    await createEnterpriseRotationProtection(options).protect(context, async providers => {
      const intents = ['cached-a', 'cached-b'].map(identity => ({ table: 'custom_entities_storage', identity, tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp }))
      const dates = await providers!.timestampForBatchWrite!(intents)
      const root = join(options.artifactRoot, (await readdir(options.artifactRoot))[0]!)
      await Promise.all(aliases.map(name => unlink(join(root, `${name}.age`))))
      const before = seal.mock.calls.length
      const originalIdentity = RotationArtifactStore.prototype.fileIdentity
      const checked: string[] = []
      metadata = jest.spyOn(RotationArtifactStore.prototype, 'fileIdentity').mockImplementation(async function (this: RotationArtifactStore, name) {
        if (aliases.includes(name)) checked.push(name)
        return originalIdentity.call(this, name)
      })
      expect(await providers!.timestampForBatchWrite!(intents)).toEqual(dates)
      expect(checked).toEqual([]); expect(seal.mock.calls.length).toBe(before)
    })
    expect(state.reports).toBe(1)
  } finally { metadata?.mockRestore(); linking.mockRestore() }
})

test('a page loaded earlier in the batch overrides a missing alias precheck for its other cached record', async () => {
  const { options, context, state } = fixture()
  const cipher = await options.cipher(); const seal = jest.spyOn(cipher, 'seal'); const decrypt = jest.spyOn(cipher, 'open'); options.cipher = async () => cipher
  let firstAliases: string[] = []
  const original = RotationArtifactStore.prototype.linkNames
  const linking = jest.spyOn(RotationArtifactStore.prototype, 'linkNames').mockImplementation(async function (this: RotationArtifactStore, source, aliases) {
    if (!firstAliases.length) firstAliases = aliases.slice()
    return original.call(this, source, aliases)
  })
  try {
    await createEnterpriseRotationProtection(options).protect(context, async providers => {
      const intent = (identity: string) => ({ table: 'custom_entities_storage', identity, tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp })
      const originalDates = await providers!.timestampForBatchWrite!([intent('page-a'), intent('page-b')])
      await providers!.timestampForBatchWrite!([intent('evict-a')]); await providers!.timestampForBatchWrite!([intent('evict-b')])
      const root = join(options.artifactRoot, (await readdir(options.artifactRoot))[0]!)
      await unlink(join(root, `${firstAliases[1]}.age`))
      const before = seal.mock.calls.length; decrypt.mockClear()
      expect(await providers!.timestampForBatchWrite!([intent('page-a'), intent('page-b')])).toEqual(originalDates)
      expect(seal.mock.calls.length).toBe(before); expect(decrypt).toHaveBeenCalledTimes(1)
    })
    expect(state.reports).toBe(1)
  } finally { linking.mockRestore() }
})

test.each(['page', 'anchor'] as const)('present timestamp %s tampering still takes the authenticated sequential load path', async target => {
  const { options, context, state } = fixture()
  const cipher = await options.cipher(); const seal = jest.spyOn(cipher, 'seal'); options.cipher = async () => cipher
  const pages: Array<{ source: string; aliases: string[] }> = []
  const original = RotationArtifactStore.prototype.linkNames
  const linking = jest.spyOn(RotationArtifactStore.prototype, 'linkNames').mockImplementation(async function (this: RotationArtifactStore, source, aliases) {
    pages.push({ source, aliases }); return original.call(this, source, aliases)
  })
  let sealCount = 0
  try {
    await expect(createEnterpriseRotationProtection(options).protect(context, async providers => {
      const intent = (identity: string) => ({ table: 'custom_entities_storage', identity, tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp })
      for (const identity of ['old-a', 'old-b', 'old-c']) await providers!.timestampForBatchWrite!([intent(identity)])
      const root = join(options.artifactRoot, (await readdir(options.artifactRoot))[0]!)
      if (target === 'page') await writeFile(join(root, `${pages[0]!.aliases[0]}.age`), 'tampered', { mode: 0o600 })
      else {
        const anchors = (await readdir(options.trustRoot)).find(name => name.endsWith('-intents'))!
        await writeFile(join(options.trustRoot, anchors, pages[0]!.source), '0'.repeat(64), { mode: 0o600 })
      }
      sealCount = seal.mock.calls.length
      await providers!.timestampForBatchWrite!([intent('old-a')])
      state.mutated = true
    })).rejects.toThrow(target === 'page' ? 'tampered' : 'METADATA_MISMATCH')
    // Failure reporting may seal a journal record; no new intent page is linked.
    expect(pages).toHaveLength(3); expect(sealCount).toBeGreaterThan(0)
    expect(state.mutated).toBe(false); expect(state.reports).toBe(0)
  } finally { linking.mockRestore() }
})

test('an alias appearing after the missing precheck fails exclusively before any timestamped SQL write', async () => {
  const { options, context, state } = fixture()
  const original = RotationArtifactStore.prototype.linkNames
  const linking = jest.spyOn(RotationArtifactStore.prototype, 'linkNames').mockImplementation(async function (this: RotationArtifactStore, source, aliases) {
    const root = join(options.artifactRoot, (await readdir(options.artifactRoot))[0]!)
    await writeFile(join(root, `${aliases[0]}.age`), 'appeared concurrently', { mode: 0o600, flag: 'wx' })
    return original.call(this, source, aliases)
  })
  try {
    await expect(createEnterpriseRotationProtection(options).protect(context, async providers => {
      await providers!.timestampForBatchWrite!([{ table: 'custom_entities_storage', identity: 'fresh-race', tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp }])
      state.mutated = true
    })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(state.mutated).toBe(false); expect(state.reports).toBe(0)
  } finally { linking.mockRestore() }
})

test('mixed existing and new timestamp intents preserve exact dates across ambiguous and repeated batches', async () => {
  const { options, context, state } = fixture()
  const cipher = await options.cipher(); const seal = jest.spyOn(cipher, 'seal'); options.cipher = async () => cipher
  await createEnterpriseRotationProtection(options).protect(context, async providers => {
    const intent = (identity: string, previousTimestamp = state.timestamp) => ({ table: 'custom_entities_storage', identity, tenantId: 'tenant', organizationId: null, previousTimestamp })
    const first = await providers!.timestampForBatchWrite!([intent('retry-a'), intent('retry-b')])
    await providers!.timestampForBatchWrite!([intent('evict-a')]); await providers!.timestampForBatchWrite!([intent('evict-b')])
    const before = seal.mock.calls.length
    const mixed = [intent('retry-a', first[0]!.toISOString()), intent('new-c'), intent('retry-b')]
    const dates = await providers!.timestampForBatchWrite!(mixed)
    expect(dates[0]).toEqual(first[0]); expect(dates[2]).toEqual(first[1])
    expect(seal.mock.calls.length - before).toBe(1)
    expect(await providers!.timestampForBatchWrite!(mixed)).toEqual(dates)
    expect(seal.mock.calls.length - before).toBe(1)
  })
  expect(state.reports).toBe(1)
})

test('a changed run-key artifact refuses resumed mutation before invoking the operation', async () => {
  const { options, context, state } = fixture(); state.wrongValue = true
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => {})).rejects.toThrow('DATA_MISMATCH')
  const records = (await readdir(options.trustRoot)).filter(name => name.endsWith('.json'))
  const id = records[0]!.slice(0, -5)
  const roots = await readdir(options.artifactRoot)
  const runKey = join(options.artifactRoot, roots[0]!, 'run-key.age')
  await writeFile(runKey, 'invalid ciphertext', { mode: 0o600 })
  const mutate = jest.fn()
  await expect(createEnterpriseRotationProtection({ ...options, resumeId: id }).protect(context, mutate)).rejects.toThrow()
  expect(mutate).not.toHaveBeenCalled()
})


test.each(['nested-trust', 'nested-artifacts'])('refuses physically nested roots even with dot-prefixed descendants: %s', async nesting => {
  const { options, context } = fixture()
  if (nesting === 'nested-trust') options.trustRoot = join(options.artifactRoot, '..trust')
  else options.artifactRoot = join(options.trustRoot, '..artifacts')
  const mutation = jest.fn()
  await expect(createEnterpriseRotationProtection(options).protect(context, mutation)).rejects.toThrow('TRUST_ANCHOR_LOCATION')
  expect(mutation).not.toHaveBeenCalled()
})


test('rights lost during recovery refuse before the first mutation', async () => {
  const { options, context, state } = fixture()
  options.recovery.verify = async () => { state.entitlement = false }
  const mutate = jest.fn()
  await expect(createEnterpriseRotationProtection(options).protect(context, mutate)).rejects.toThrow('entitlement')
  expect(mutate).not.toHaveBeenCalled()
})


test('rights lost during the final persisted scan cannot publish success', async () => {
  const { options, context, state } = fixture(); const factory = options.dataset
  options.dataset = async (...args) => {
    const data = await factory(...args)
    return { ...data, async *rows(phase, signal) { yield* data.rows(phase, signal); if (phase === 'after') state.entitlement = false } }
  }
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => {})).rejects.toThrow('entitlement')
  expect(state.reports).toBe(0)
})


test('direct protected callers cannot checkpoint writes hidden inside an outer transaction', async () => {
  const { state, options, context } = fixture()
  context.entityManager = { isInTransaction: () => true } as unknown as EntityManager
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => { state.mutated = true })).rejects.toThrow('ACTIVE_TRANSACTION_UNSUPPORTED')
  expect(state.creates).toBe(0); expect(state.mutated).toBe(false)
})

test('coalesces concurrent intent-page reads and retains only bounded current/next pages', async () => {
  const { options, context, state } = fixture(); const factory = options.dataset
  let loader: Parameters<typeof factory>[3] | undefined
  options.dataset = async (...args) => { loader = args[3]; return factory(...args) }
  const cipher = await options.cipher(); const open = jest.spyOn(cipher, 'open'); options.cipher = async () => cipher
  await createEnterpriseRotationProtection(options).protect(context, async providers => {
    const intent = (identity: string) => ({ table: 'custom_entities_storage', identity, tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp })
    for (const ids of [['a', 'b'], ['c', 'd'], ['e', 'f']]) await providers!.timestampForBatchWrite!(ids.map(intent))
    const identity = (id: string) => JSON.stringify(['public.custom_entities_storage', 'tenant', null, [id]])
    open.mockClear()
    const records = await Promise.all([loader!.prefetch!([identity('a'), identity('b')]), loader!.load(identity('a')), loader!.load(identity('b'))])
    expect(records[1]).toBeDefined(); expect(records[2]).toBeDefined()
    expect(open).toHaveBeenCalledTimes(1)
    await loader!.load(identity('a')); expect(open).toHaveBeenCalledTimes(1)
  })
})

test('prefetches a late boundary in the bounded identity page but never loads a second future page', async () => {
  const { options, context, state } = fixture(); const factory = options.dataset
  let loader: Parameters<typeof factory>[3] | undefined
  options.dataset = async (...args) => { loader = args[3]; return factory(...args) }
  const cipher = await options.cipher(); const open = jest.spyOn(cipher, 'open'); options.cipher = async () => cipher
  await createEnterpriseRotationProtection(options).protect(context, async providers => {
    const intent = (identity: string) => ({ table: 'custom_entities_storage', identity, tenantId: 'tenant', organizationId: null, previousTimestamp: state.timestamp })
    const cached = Array.from({ length: 8 }, (_, index) => `cached-${index}`)
    for (const ids of [['first'], ['second'], cached]) await providers!.timestampForBatchWrite!(ids.map(intent))
    const identity = (id: string) => JSON.stringify(['public.custom_entities_storage', 'tenant', null, [id]])
    open.mockClear()
    await loader!.prefetch!([...cached.map(identity), identity('first'), identity('second')])
    expect(open).toHaveBeenCalledTimes(1)
    expect(await loader!.load(identity('first'))).toBeDefined()
    expect(open).toHaveBeenCalledTimes(1)
    expect(await loader!.load(identity('second'))).toBeDefined()
    expect(open).toHaveBeenCalledTimes(2)
  })
})

test('failure reports include only authenticated aggregates from the current verification attempt', async () => {
  const { options, context, state } = fixture(); state.wrongValue = true
  const report = jest.fn(async (..._args: Parameters<NonNullable<RotationCoordinatorOptions['reportFailure']>>) => {}); options.reportFailure = report
  await expect(createEnterpriseRotationProtection(options).protect(context, async () => {})).rejects.toThrow('DATA_MISMATCH')
  expect(report.mock.calls[0]![4]).toMatchObject({ elapsedMs: expect.any(Number), verificationDurationMs: expect.any(Number), expectedRows: '1', comparedRows: '0', expectedFields: '1', comparedFields: '0', expectedBytes: expect.any(String), comparedBytes: '0' })
  const early = fixture(); early.state.fence = false; const earlyReport = jest.fn(async (..._args: Parameters<NonNullable<RotationCoordinatorOptions['reportFailure']>>) => {}); early.options.reportFailure = earlyReport
  await expect(createEnterpriseRotationProtection(early.options).protect(early.context, async () => {})).rejects.toThrow('fence lost')
  expect(earlyReport.mock.calls[0]![4]).toEqual({ elapsedMs: expect.any(Number) })
})


test.each(['run identity', 'database binding'])('an unadmitted resume with a different %s cannot rewrite trusted state or publish a failed run', async mismatch => {
  const { options, context } = fixture()
  await createEnterpriseRotationProtection(options).protect(context, async () => {})
  const record = (await readdir(options.trustRoot)).find(name => name.endsWith('.json'))!
  const id = record.slice(0, -5); const statePath = join(options.trustRoot, record)
  if (mismatch === 'run identity') {
    const candidate = JSON.parse(await readFile(statePath, 'utf8'))
    candidate.id = '00000000-0000-4000-8000-000000000001'
    await writeFile(statePath, JSON.stringify(candidate), { mode: 0o600 })
  } else {
    const dataset = options.dataset
    options.dataset = async (...args) => {
      const original = await dataset(...args)
      return { ...original, async binding() { return { ...await original.binding(), database: 'different-database' } } }
    }
  }
  const before = await readFile(statePath)
  const reportFailure = jest.fn(); const operation = jest.fn()
  await expect(createEnterpriseRotationProtection({ ...options, resumeId: id, reportFailure }).protect(context, operation)).rejects.toThrow('ROTATION_RESUME_INVALID')
  expect(await readFile(statePath)).toEqual(before)
  expect(operation).not.toHaveBeenCalled()
  expect(reportFailure).not.toHaveBeenCalled()
})
