import {
  TenantDataEncryptionError,
  TenantDataEncryptionErrorCode,
  decryptWithAesGcm,
  encryptWithAesGcm,
  hashForLookup,
  isEncryptedPayloadShape,
} from '../aes'
import {
  TenantDataEncryptionService,
  parseDecryptedFieldValue,
} from '../tenantDataEncryptionService'
import { forgetEncryptionPolicyMemo } from '../policyMemo'

const fixedKey = Buffer.alloc(32, 1).toString('base64')

describe('parseDecryptedFieldValue', () => {
  it('keeps purely-numeric strings as strings (regression: issue #1734)', () => {
    expect(parseDecryptedFieldValue('123')).toBe('123')
    expect(parseDecryptedFieldValue('00042')).toBe('00042')
    expect(parseDecryptedFieldValue('-9.5')).toBe('-9.5')
  })

  it('keeps boolean-like and null-like text as strings', () => {
    expect(parseDecryptedFieldValue('true')).toBe('true')
    expect(parseDecryptedFieldValue('false')).toBe('false')
    expect(parseDecryptedFieldValue('null')).toBe('null')
  })

  it('keeps ordinary text untouched', () => {
    expect(parseDecryptedFieldValue('Acme Corp')).toBe('Acme Corp')
    expect(parseDecryptedFieldValue('')).toBe('')
  })

  it('parses JSON objects and arrays back to structured values', () => {
    expect(parseDecryptedFieldValue('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' })
    expect(parseDecryptedFieldValue('[1,2,3]')).toEqual([1, 2, 3])
    expect(parseDecryptedFieldValue('[]')).toEqual([])
  })

  it('returns the raw text when the JSON-looking payload fails to parse', () => {
    expect(parseDecryptedFieldValue('{not json')).toBe('{not json')
    expect(parseDecryptedFieldValue('[broken')).toBe('[broken')
  })
})

describe('TenantDataEncryptionService.decryptFields (issue #1734)', () => {
  function makeService() {
    type Anything = Record<string, unknown>
    const service = new TenantDataEncryptionService({} as never) as unknown as {
      decryptFields: (
        obj: Anything,
        fields: { field: string }[],
        dek: { key: string },
      ) => Anything
    }
    return service
  }

  function encrypt(value: string): string {
    return encryptWithAesGcm(value, fixedKey).value as string
  }

  it('preserves a numeric-string display name through encrypt/decrypt round-trip', () => {
    const service = makeService()
    const obj = { display_name: encrypt('123') }
    const out = service.decryptFields(obj, [{ field: 'display_name' }], { key: fixedKey } as never)
    expect(out.display_name).toBe('123')
    expect(typeof out.display_name).toBe('string')
  })

  it('preserves arbitrary text values through encrypt/decrypt round-trip', () => {
    const service = makeService()
    const obj = {
      display_name: encrypt('Acme Corp'),
      primary_email: encrypt('mail@example.com'),
    }
    const out = service.decryptFields(
      obj,
      [{ field: 'display_name' }, { field: 'primary_email' }],
      { key: fixedKey } as never,
    )
    expect(out.display_name).toBe('Acme Corp')
    expect(out.primary_email).toBe('mail@example.com')
  })

  it('returns the raw JSON-string payload for JSON-object values (issue #1810 follow-up)', () => {
    // After the issue #1810 follow-up, decryptFields no longer auto-parses
    // decrypted entity-field strings — even when they happen to look like
    // JSON. Callers that legitimately need the parsed shape (audit_logs jsonb
    // columns, custom-field rotation, encryption CLI) MUST invoke
    // `parseDecryptedFieldValue` themselves on the decrypted payload.
    const service = makeService()
    const payload = { actor: 'user-1', changes: { name: 'old → new' } }
    const serialized = JSON.stringify(payload)
    const obj = { context_json: encrypt(serialized) }
    const out = service.decryptFields(obj, [{ field: 'context_json' }], { key: fixedKey } as never)
    expect(out.context_json).toBe(serialized)
    expect(typeof out.context_json).toBe('string')
  })

  it('returns the raw JSON-string payload for JSON-array values', () => {
    const service = makeService()
    const arr = [{ id: 1 }, { id: 2 }]
    const serialized = JSON.stringify(arr)
    const obj = { thread_messages: encrypt(serialized) }
    const out = service.decryptFields(obj, [{ field: 'thread_messages' }], { key: fixedKey } as never)
    expect(out.thread_messages).toBe(serialized)
    expect(typeof out.thread_messages).toBe('string')
  })

  it('preserves JSON-object-shaped display names as raw strings (regression: issue #1810)', () => {
    // Display names like `{"a":1,"qa":12345}` are typed as text and must remain
    // strings so React can render them safely in detail/list views. Auto-parsing
    // them used to throw "Objects are not valid as a React child".
    const service = makeService()
    const raw = '{"a":1,"qa":12345}'
    const obj = { display_name: encrypt(raw) }
    const out = service.decryptFields(obj, [{ field: 'display_name' }], { key: fixedKey } as never)
    expect(out.display_name).toBe(raw)
    expect(typeof out.display_name).toBe('string')
  })

  it('keeps boolean-like and null-like text strings as strings', () => {
    const service = makeService()
    const obj = {
      display_name: encrypt('true'),
      description: encrypt('null'),
    }
    const out = service.decryptFields(
      obj,
      [{ field: 'display_name' }, { field: 'description' }],
      { key: fixedKey } as never,
    )
    expect(out.display_name).toBe('true')
    expect(out.description).toBe('null')
  })
})

describe('isEncryptedPayloadShape (issue #5951)', () => {
  it('accepts a real AES-GCM envelope regardless of which key sealed it', () => {
    const otherKey = Buffer.alloc(32, 7).toString('base64')
    expect(isEncryptedPayloadShape(encryptWithAesGcm('x', fixedKey).value)).toBe(true)
    expect(isEncryptedPayloadShape(encryptWithAesGcm('x', otherKey).value)).toBe(true)
  })

  it('rejects the loose four-segment shapes a length-blind check would accept', () => {
    // The IV and tag decode to 3 and 3 bytes, not 12 and 16 — no AES-GCM payload looks like this.
    expect(isEncryptedPayloadShape('aaaa:bbbb:cccc:v1')).toBe(false)
    expect(isEncryptedPayloadShape('user:supplied:colon:v1')).toBe(false)
  })

  it('rejects plaintext, non-strings, and wrong-version payloads', () => {
    expect(isEncryptedPayloadShape('mail@example.com')).toBe(false)
    expect(isEncryptedPayloadShape('')).toBe(false)
    expect(isEncryptedPayloadShape(null)).toBe(false)
    expect(isEncryptedPayloadShape(42)).toBe(false)
    expect(isEncryptedPayloadShape((encryptWithAesGcm('x', fixedKey).value as string).replace(/:v1$/, ':v2'))).toBe(false)
  })

  it('rejects an envelope whose ciphertext segment is empty', () => {
    const real = encryptWithAesGcm('x', fixedKey).value as string
    const [iv, , tag] = real.split(':')
    expect(isEncryptedPayloadShape(`${iv}::${tag}:v1`)).toBe(false)
  })
})

describe('TenantDataEncryptionService.encryptFields (issue #2720)', () => {
  function makeService() {
    type Anything = Record<string, unknown>
    const service = new TenantDataEncryptionService({} as never) as unknown as {
      encryptFields: (
        obj: Anything,
        fields: { field: string; hashField?: string | null }[],
        dek: { key: string },
      ) => Anything
    }
    return service
  }

  it('encrypts a forged ciphertext-shaped value instead of storing it verbatim', () => {
    const service = makeService()
    const forged = 'aaaa:bbbb:cccc:v1'
    const out = service.encryptFields(
      { email: forged },
      [{ field: 'email', hashField: 'email_hash' }],
      { key: fixedKey } as never,
    )
    expect(out.email).not.toBe(forged)
    expect(typeof out.email).toBe('string')
    // The stored value must be real ciphertext that decrypts back to the forged input.
    expect(decryptWithAesGcm(out.email as string, fixedKey)).toBe(forged)
    // The lookup hash must be generated (the bypass previously skipped it).
    expect(out.email_hash).toBe(hashForLookup(forged))
  })

  it('does not re-encrypt a value that genuinely decrypts under the DEK', () => {
    const service = makeService()
    const real = encryptWithAesGcm('mail@example.com', fixedKey).value as string
    const out = service.encryptFields(
      { email: real },
      [{ field: 'email' }],
      { key: fixedKey } as never,
    )
    expect(out.email).toBe(real)
  })

  // Superseded by issue #5951: this case used to assert that a payload sealed under another
  // key gets encrypted again. That is what produced the undetectable nested envelope — the
  // value is real ciphertext (the previous DEK mid-rotation, or the derived key the KMS falls
  // back to during a Vault outage), not a forgery, and wrapping it destroys it. The write now
  // fails closed. #2720 is unaffected: nothing is stored verbatim on this path either way.
  it('refuses to re-encrypt a payload that was sealed with a different key', () => {
    const service = makeService()
    const otherKey = Buffer.alloc(32, 2).toString('base64')
    const sealedElsewhere = encryptWithAesGcm('secret', otherKey).value as string
    expect(() =>
      service.encryptFields(
        { email: sealedElsewhere },
        [{ field: 'email' }],
        { key: fixedKey } as never,
      ),
    ).toThrow(TenantDataEncryptionError)
  })

  it('reports the wrong-key case with a distinct error code and leaves the value out of the message', () => {
    const service = makeService()
    const otherKey = Buffer.alloc(32, 2).toString('base64')
    const sealedElsewhere = encryptWithAesGcm('secret@example.com', otherKey).value as string
    try {
      service.encryptFields(
        { email: sealedElsewhere },
        [{ field: 'email' }],
        { key: fixedKey } as never,
      )
      throw new Error('[internal] expected encryptFields to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(TenantDataEncryptionError)
      expect((err as TenantDataEncryptionError).code).toBe(TenantDataEncryptionErrorCode.WRONG_KEY)
      // The ciphertext must never be echoed back into an error surfaced to a caller.
      expect((err as TenantDataEncryptionError).message).not.toContain(sealedElsewhere)
      expect((err as TenantDataEncryptionError).message).toContain('email')
    }
  })

  it('never emits a nested envelope or a hash of ciphertext when the DEK changed', () => {
    const service = makeService()
    const previousDek = Buffer.alloc(32, 2).toString('base64')
    const sealedUnderPreviousDek = encryptWithAesGcm('mail@example.com', previousDek).value as string
    const input = { email: sealedUnderPreviousDek, email_hash: hashForLookup('mail@example.com') }
    const inputSnapshot = { ...input }

    // encryptFields must reject the call outright rather than return a payload — a toBeNull()
    // check on a try/catch result would also pass if it threw for an unrelated reason, so assert
    // the throw directly.
    expect(() =>
      service.encryptFields(
        input,
        [{ field: 'email', hashField: 'email_hash' }],
        { key: fixedKey } as never,
      ),
    ).toThrow(TenantDataEncryptionError)

    // encryptFields clones before mutating, so a rejected call must leave the caller's object
    // untouched — no nested envelope, no hash overwritten with one computed over ciphertext.
    expect(input).toEqual(inputSnapshot)

    // Illustrative only (not an assertion on the code under test): before the fix, the case
    // above returned a writable payload containing one more AES-GCM layer whose plaintext was
    // the previous envelope, plus a lookup hash computed over ciphertext instead of over the
    // email — neither of which any read path could undo.
  })

  it('encrypts plaintext that happens to look like a v1 payload', () => {
    const service = makeService()
    const plaintext = 'user:supplied:colon:v1'
    const out = service.encryptFields(
      { email: plaintext },
      [{ field: 'email', hashField: 'email_hash' }],
      { key: fixedKey } as never,
    )
    expect(out.email).not.toBe(plaintext)
    expect(decryptWithAesGcm(out.email as string, fixedKey)).toBe(plaintext)
    expect(out.email_hash).toBe(hashForLookup(plaintext))
  })
})

describe('TenantDataEncryptionService system-scoped maps', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  it('encrypts tenant-less payloads with a stable entity-scoped KMS key', async () => {
    const entityId = 'onboarding:onboarding_request'
    const systemKeyId = `system:${entityId}`
    const getTenantDek = jest.fn(async (keyId: string) => (
      keyId === systemKeyId
        ? { tenantId: keyId, key: fixedKey, fetchedAt: new Date() }
        : null
    ))
    const service = new TenantDataEncryptionService(
      {
        execute: jest.fn(async () => []),
        getConnection: () => ({ execute: jest.fn(async () => []) }),
      } as never,
      {
        kms: {
          getTenantDek,
          createTenantDek: jest.fn(async () => null),
          isHealthy: () => true,
        },
        defaultEncryptionMaps: [
          {
            entityId,
            keyScope: 'system',
            fields: [
              { field: 'email', hashField: 'email_hash' },
              { field: 'password_hash' },
            ],
          },
        ],
      } as never,
    )

    const encrypted = await service.encryptEntityPayload(entityId, {
      email: 'person@example.com',
      email_hash: null,
      password_hash: 'bcrypt-value',
    }, null, null)

    expect(getTenantDek).toHaveBeenCalledWith(systemKeyId)
    expect(encrypted.email).not.toBe('person@example.com')
    expect(encrypted.password_hash).not.toBe('bcrypt-value')
    expect(encrypted.email_hash).toBe(hashForLookup('person@example.com'))
    expect(decryptWithAesGcm(encrypted.email as string, fixedKey)).toBe('person@example.com')
    expect(decryptWithAesGcm(encrypted.password_hash as string, fixedKey)).toBe('bcrypt-value')
  })
})

type PolicyRow = {
  entity_id: string
  tenant_id: string | null
  organization_id: string | null
  fields_json: Array<{ field: string; hashField?: string | null }>
}

// Evaluates the scope predicate of the single policy statement against an in-memory table:
// `[entityId, tenantId]` selects every row of the tenant plus the global row (tenant-wide scope,
// including the all-organizations aggregate); `[entityId, tenantId, organizationId]` selects the
// exact, tenant-wide and global rows only.
function selectPolicyRows(table: readonly PolicyRow[], params: readonly unknown[]): PolicyRow[] {
  const [entityId, tenantId, organizationId] = params
  return table.filter((row) => {
    if (row.entity_id !== entityId) return false
    if (row.tenant_id === null && row.organization_id === null) return true
    if (row.tenant_id !== (tenantId ?? null)) return false
    if (params.length === 2) return true
    return row.organization_id === null || row.organization_id === organizationId
  })
}

function makePolicyEm(readTable: () => readonly PolicyRow[]) {
  const execute = jest.fn(async (_sql: string, params: readonly unknown[] = []) => selectPolicyRows(readTable(), params))
  return { em: { execute }, execute }
}

describe('TenantDataEncryptionService.getEncryptedFieldNames', () => {
  it('returns active encryption-map field names for query planning', async () => {
    const entityId = 'customers:customer_entity'
    const { em } = makePolicyEm(() => [{
      entity_id: entityId,
      tenant_id: 't1',
      organization_id: 'org1',
      fields_json: [
        { field: 'display_name' },
        { field: 'primary_email' },
        { field: '' },
        { field: null as unknown as string },
      ],
    }])
    const service = new TenantDataEncryptionService(em as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)

    await expect(
      service.getEncryptedFieldNames(entityId, 't1', 'org1'),
    ).resolves.toEqual(['display_name', 'primary_email'])
  })

  it('returns org-scoped field union for all-organization query planning in one statement', async () => {
    const entityId = 'test:all_org_customer_entity'
    const { em, execute } = makePolicyEm(() => [
      { entity_id: entityId, tenant_id: 'tenant-all', organization_id: 'org-a', fields_json: [{ field: 'display_name' }, { field: 'primary_email' }] },
      { entity_id: entityId, tenant_id: 'tenant-all', organization_id: 'org-b', fields_json: [{ field: 'display_name' }, { field: 'description' }, { field: '' }] },
      { entity_id: entityId, tenant_id: 'other-tenant', organization_id: 'org-c', fields_json: [{ field: 'foreign' }] },
    ])
    const service = new TenantDataEncryptionService(em as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)

    await expect(
      service.getEncryptedFieldNames(entityId, 'tenant-all', null),
    ).resolves.toEqual(['display_name', 'primary_email', 'description'])

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id is null and organization_id is null'),
      [entityId, 'tenant-all'],
    )
  })

  it('resolves the exact, tenant-wide and global fallback chain with one statement', async () => {
    const entityId = 'test:fallback_chain'
    let table: PolicyRow[] = [
      { entity_id: entityId, tenant_id: null, organization_id: null, fields_json: [{ field: 'global' }] },
      { entity_id: entityId, tenant_id: 'tenant-1', organization_id: null, fields_json: [{ field: 'tenant_wide' }] },
      { entity_id: entityId, tenant_id: 'tenant-1', organization_id: 'org-1', fields_json: [{ field: 'exact' }] },
    ]
    const { em, execute } = makePolicyEm(() => table)
    const service = new TenantDataEncryptionService(em as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)

    await expect(service.getEncryptedFieldNames(entityId, 'tenant-1', 'org-1')).resolves.toEqual(['exact'])
    table = table.filter((row) => row.organization_id !== 'org-1')
    await expect(service.getEncryptedFieldNames(entityId, 'tenant-1', 'org-1')).resolves.toEqual(['tenant_wide'])
    table = table.filter((row) => row.tenant_id !== 'tenant-1')
    await expect(service.getEncryptedFieldNames(entityId, 'tenant-1', 'org-1')).resolves.toEqual(['global'])
    expect(execute).toHaveBeenCalledTimes(3)
    for (const [, params] of execute.mock.calls) expect(params).toEqual([entityId, 'tenant-1', 'org-1'])
  })

  it('fails closed when the EntityManager cannot execute SQL', async () => {
    const service = new TenantDataEncryptionService({} as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)

    await expect(service.getEncryptedFieldNames('test:no_executor', 'tenant-1', 'org-1'))
      .rejects.toThrow('[internal]')
  })
})

describe('TenantDataEncryptionService canonical map reads and invalidation', () => {
  it('re-reads exact and all-organizations policies without waiting for invalidation', async () => {
    const entityId = 'test:cache_invalidation_hit'
    const tenantId = 'tenant-cache-invalidation-hit'
    const organizationId = 'org-cache-invalidation-hit'
    let exactFields = [{ field: 'existing_exact' }]
    let aggregateFields = [{ field: 'existing_aggregate' }]
    const { em } = makePolicyEm(() => [
      { entity_id: entityId, tenant_id: tenantId, organization_id: organizationId, fields_json: exactFields },
      { entity_id: entityId, tenant_id: tenantId, organization_id: 'org-aggregate', fields_json: aggregateFields },
    ])
    const service = new TenantDataEncryptionService(em as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId))
      .resolves.toEqual(['existing_exact'])
    await expect(service.getEncryptedFieldNames(entityId, tenantId, null))
      .resolves.toEqual(['existing_exact', 'existing_aggregate'])

    exactFields = [{ field: 'existing_exact' }, { field: 'fresh_exact' }]
    aggregateFields = [{ field: 'existing_aggregate' }, { field: 'fresh_aggregate' }]

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId))
      .resolves.toEqual(['existing_exact', 'fresh_exact'])
    await expect(service.getEncryptedFieldNames(entityId, tenantId, null))
      .resolves.toEqual(['existing_exact', 'fresh_exact', 'existing_aggregate', 'fresh_aggregate'])

    await service.invalidateMap(entityId, tenantId, organizationId)

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId))
      .resolves.toEqual(['existing_exact', 'fresh_exact'])
  })

  it('does not retain an exact miss after a map is committed', async () => {
    const entityId = 'test:cache_invalidation_miss'
    const tenantId = 'tenant-cache-invalidation-miss'
    const organizationId = 'org-cache-invalidation-miss'
    let table: PolicyRow[] = []
    const { em } = makePolicyEm(() => table)
    const service = new TenantDataEncryptionService(em as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId)).resolves.toEqual([])
    table = [{ entity_id: entityId, tenant_id: tenantId, organization_id: organizationId, fields_json: [{ field: 'fresh_after_miss' }] }]
    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId))
      .resolves.toEqual(['fresh_after_miss'])
  })

  it('never reads, publishes or deletes shared-cache entries', async () => {
    const entityId = 'test:canonical_policy_over_shared_cache'
    const tenantId = 'tenant-canonical-policy'
    const organizationId = 'org-canonical-policy'
    const cache = {
      get: jest.fn(async () => ({ entityId, fields: [{ field: 'stale_shared_cache' }] })),
      set: jest.fn(async () => undefined),
      delete: jest.fn(async () => {
        throw new Error('sensitive backend endpoint')
      }),
    }
    const { em } = makePolicyEm(() => [
      { entity_id: entityId, tenant_id: tenantId, organization_id: organizationId, fields_json: [{ field: 'fresh_exact' }] },
    ])
    const service = new TenantDataEncryptionService(em as never, { cache: cache as never })
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId))
      .resolves.toEqual(['fresh_exact'])
    await expect(service.invalidateMap(entityId, tenantId, organizationId)).resolves.toBeUndefined()
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
    expect(cache.delete).not.toHaveBeenCalled()
  })
})

describe('TenantDataEncryptionService per-unit-of-work policy memo', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION
  const tenantId = 'tenant-memo'
  const organizationId = 'org-memo'

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  function makeService(entityId: string, table: { rows: PolicyRow[] }) {
    const { execute } = makePolicyEm(() => table.rows)
    const service = new TenantDataEncryptionService({ execute } as never, {
      kms: {
        getTenantDek: jest.fn(async (keyId: string) => ({ tenantId: keyId, key: fixedKey, fetchedAt: Date.now() })),
        createTenantDek: jest.fn(async () => null),
        isHealthy: () => true,
      },
    } as never)
    table.rows.push({ entity_id: entityId, tenant_id: tenantId, organization_id: null, fields_json: [{ field: 'secret' }] })
    return { service, execute }
  }

  function makeUnitOfWork(execute: jest.Mock) {
    return { execute } as never
  }

  it('reads policy once per distinct scope for N decrypts on the same EntityManager', async () => {
    const entityId = 'test:memo_same_em'
    const table = { rows: [] as PolicyRow[] }
    const { service, execute } = makeService(entityId, table)
    const em = makeUnitOfWork(execute)
    const ciphertext = encryptWithAesGcm('value', fixedKey).value as string

    const decrypted = await Promise.all(Array.from({ length: 25 }, () => (
      service.decryptEntityPayload(entityId, { secret: ciphertext }, tenantId, organizationId, { em })
    )))
    await service.decryptEntityPayload(entityId, { secret: ciphertext }, tenantId, null, { em })
    await service.encryptEntityPayload(entityId, { secret: 'value' }, tenantId, organizationId, { em })

    expect(decrypted.every((row) => row.secret === 'value')).toBe(true)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls.map(([, params]) => params)).toEqual([
      [entityId, tenantId, organizationId],
      [entityId, tenantId],
    ])
  })

  it('keeps memos of different EntityManagers and transactions independent', async () => {
    const entityId = 'test:memo_independent_em'
    const table = { rows: [] as PolicyRow[] }
    const { service, execute } = makeService(entityId, table)
    const first = makeUnitOfWork(execute)
    const second = makeUnitOfWork(execute)
    const transaction = {}
    const transactional = { execute, getTransactionContext: () => transaction } as never

    await service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em: first })
    table.rows[0].fields_json = [{ field: 'secret' }, { field: 'rotated' }]
    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em: first }))
      .resolves.toEqual(['secret'])
    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em: second }))
      .resolves.toEqual(['secret', 'rotated'])
    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em: transactional }))
      .resolves.toEqual(['secret', 'rotated'])
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('never memoizes lookups that fall back to the service EntityManager', async () => {
    const entityId = 'test:memo_fallback_em'
    const table = { rows: [] as PolicyRow[] }
    const { service, execute } = makeService(entityId, table)

    await service.getEncryptedFieldNames(entityId, tenantId, organizationId)
    await service.getEncryptedFieldNames(entityId, tenantId, organizationId)

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('drops the memo when a map write goes through that EntityManager', async () => {
    const entityId = 'test:memo_write_forget'
    const table = { rows: [] as PolicyRow[] }
    const { service, execute } = makeService(entityId, table)
    const em = makeUnitOfWork(execute)

    await service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em })
    table.rows[0].fields_json = [{ field: 'secret' }, { field: 'added' }]
    forgetEncryptionPolicyMemo(em)

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em }))
      .resolves.toEqual(['secret', 'added'])
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('drops every memo of this process when a map is invalidated', async () => {
    const entityId = 'test:memo_invalidate'
    const table = { rows: [] as PolicyRow[] }
    const { service, execute } = makeService(entityId, table)
    const em = makeUnitOfWork(execute)

    await service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em })
    table.rows[0].fields_json = [{ field: 'secret' }, { field: 'added' }]
    await service.invalidateMap(entityId, tenantId, null)

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em }))
      .resolves.toEqual(['secret', 'added'])
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('does not memoize a failed read', async () => {
    const entityId = 'test:memo_failed_read'
    const table = { rows: [] as PolicyRow[] }
    const { service, execute } = makeService(entityId, table)
    execute.mockRejectedValueOnce(new Error('connection terminated'))
    const em = makeUnitOfWork(execute)

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em }))
      .rejects.toThrow('connection terminated')
    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId, { em }))
      .resolves.toEqual(['secret'])
  })
})

describe('TenantDataEncryptionService duplicate map fail-safe', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  it('deterministically unions active duplicate rows so no declared field is stored as plaintext', async () => {
    const entityId = 'test:duplicate_encryption_map'
    const tenantId = 'tenant-duplicate-map'
    const execute = jest.fn(async (sql: string) => {
      expect(sql).toContain('order by organization_id asc, created_at asc, id asc')
      return [
        {
          entity_id: entityId,
          tenant_id: tenantId,
          organization_id: 'org-1',
          fields_json: [
            { field: 'email' },
            { field: 'display_name', hashField: 'display_name_hash' },
          ],
        },
        {
          entity_id: entityId,
          tenant_id: tenantId,
          organization_id: 'org-1',
          fields_json: [
            { field: 'email', hashField: 'email_hash' },
            { field: 'phone' },
          ],
        },
      ]
    })
    const service = new TenantDataEncryptionService(
      { execute, getConnection: () => ({ execute }) } as never,
      {
        kms: {
          getTenantDek: jest.fn(async () => ({ tenantId, key: fixedKey, fetchedAt: new Date() })),
          createTenantDek: jest.fn(async () => null),
          isHealthy: () => true,
        },
      } as never,
    )

    const encrypted = await service.encryptEntityPayload(
      entityId,
      {
        email: 'person@example.com',
        email_hash: null,
        display_name: 'Person',
        display_name_hash: null,
        phone: '+48123456789',
      },
      tenantId,
      'org-1',
    )

    expect(decryptWithAesGcm(encrypted.email as string, fixedKey)).toBe('person@example.com')
    expect(encrypted.email_hash).toBe(hashForLookup('person@example.com'))
    expect(decryptWithAesGcm(encrypted.display_name as string, fixedKey)).toBe('Person')
    expect(encrypted.display_name_hash).toBe(hashForLookup('Person'))
    expect(decryptWithAesGcm(encrypted.phone as string, fixedKey)).toBe('+48123456789')
  })
})

describe('TenantDataEncryptionService tenant-wide scope parity (issue #5949)', () => {
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION
  const tenantId = 'tenant-5949'

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterEach(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  // A base (organization-less) map declaring `display_name`, plus an organization-scoped map that
  // declares the extra `description` field. At organizationId = null the policy statement also
  // returns the organization-scoped rows (2-parameter form) for the all-organizations aggregate.
  function makeService(entityId: string) {
    const { execute } = makePolicyEm(() => [
      { entity_id: entityId, tenant_id: tenantId, organization_id: null, fields_json: [{ field: 'display_name' }] },
      {
        entity_id: entityId,
        tenant_id: tenantId,
        organization_id: 'org-with-description',
        fields_json: [{ field: 'description', hashField: 'description_hash' }],
      },
    ])
    const service = new TenantDataEncryptionService(
      { execute } as never,
      {
        kms: {
          getTenantDek: jest.fn(async (keyId: string) => (
            keyId === tenantId ? { tenantId: keyId, key: fixedKey, fetchedAt: new Date() } : null
          )),
          createTenantDek: jest.fn(async () => null),
          isHealthy: () => true,
        },
      } as never,
    )
    return { service, execute }
  }

  it('encrypts fields declared only on an organization-scoped map at the tenant-wide scope', async () => {
    const entityId = 'test:parity_encrypt_entity'
    const { service } = makeService(entityId)

    const encrypted = await service.encryptEntityPayload(
      entityId,
      { display_name: 'Acme Corp', description: 'confidential note' },
      tenantId,
      null,
    )

    expect(decryptWithAesGcm(encrypted.display_name as string, fixedKey)).toBe('Acme Corp')
    expect(encrypted.description).not.toBe('confidential note')
    expect(decryptWithAesGcm(encrypted.description as string, fixedKey)).toBe('confidential note')
    expect(encrypted.description_hash).toBe(hashForLookup('confidential note'))
  })

  it('decrypts fields declared only on an organization-scoped map at the tenant-wide scope', async () => {
    const entityId = 'test:parity_decrypt_entity'
    const { service } = makeService(entityId)

    const decrypted = await service.decryptEntityPayload(
      entityId,
      {
        display_name: encryptWithAesGcm('Acme Corp', fixedKey).value as string,
        description: encryptWithAesGcm('confidential note', fixedKey).value as string,
      },
      tenantId,
      null,
    )

    expect(decrypted.display_name).toBe('Acme Corp')
    expect(decrypted.description).toBe('confidential note')
  })

  it('reports exactly the fields the payload functions act on at the tenant-wide scope', async () => {
    const entityId = 'test:parity_reported_entity'
    const { service } = makeService(entityId)

    const reported = await service.getEncryptedFieldNames(entityId, tenantId, null)
    const encrypted = await service.encryptEntityPayload(
      entityId,
      { display_name: 'Acme Corp', description: 'confidential note' },
      tenantId,
      null,
    )

    expect(reported).toEqual(['display_name', 'description'])
    const actuallyEncrypted = reported.filter((field) => encrypted[field] !== undefined
      && decryptWithAesGcm(encrypted[field] as string, fixedKey) !== null)
    expect(actuallyEncrypted).toEqual(reported)
  })

  it('leaves an organization-scoped call on its own map without the all-organizations read', async () => {
    const entityId = 'test:parity_org_scoped_entity'
    const { service, execute } = makeService(entityId)

    const encrypted = await service.encryptEntityPayload(
      entityId,
      { display_name: 'Acme Corp', description: 'confidential note' },
      tenantId,
      'org-1',
    )

    expect(encrypted.description).toBe('confidential note')
    expect(execute).not.toHaveBeenCalledWith(expect.anything(), [entityId, tenantId])
  })

  it('re-reads the all-organizations aggregate across payload calls', async () => {
    const entityId = 'test:parity_canonical_entity'
    const { service, execute } = makeService(entityId)

    await service.encryptEntityPayload(entityId, { description: 'first' }, tenantId, null)
    await service.encryptEntityPayload(entityId, { description: 'second' }, tenantId, null)

    const aggregateReads = execute.mock.calls.filter(([, params]) => (params as unknown[]).length === 2)
    expect(aggregateReads).toHaveLength(2)
  })
})

describe('TenantDataEncryptionService map read failures (issue #6334)', () => {
  const tenantId = 'tenant-6334'
  const organizationId = 'org-6334'
  const mapRow = (entityId: string) => [{
    entity_id: entityId,
    tenant_id: tenantId,
    organization_id: organizationId,
    fields_json: [{ field: 'display_name' }],
  }]

  function makeService(execute: jest.Mock) {
    const service = new TenantDataEncryptionService({ execute, getConnection: () => ({ execute }) } as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)
    return service
  }

  it('retries the map read after a failed one instead of replaying the stored rejection', async () => {
    const entityId = 'test:inflight_rejection_entity'
    const execute = jest.fn()
      .mockRejectedValueOnce(new Error('connection terminated'))
      .mockImplementation(async () => mapRow(entityId))
    const service = makeService(execute)

    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId))
      .rejects.toThrow('connection terminated')
    await expect(service.getEncryptedFieldNames(entityId, tenantId, organizationId))
      .resolves.toEqual(['display_name'])
  })

  it('does not couple a concurrent reader to another failing read', async () => {
    const entityId = 'test:inflight_joined_rejection_entity'
    let rejectFirst: (error: Error) => void = () => {}
    const execute = jest.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
      .mockImplementation(async () => mapRow(entityId))
    const service = makeService(execute)

    const owner = service.getEncryptedFieldNames(entityId, tenantId, organizationId)
    const joiner = service.getEncryptedFieldNames(entityId, tenantId, organizationId)
    await new Promise((resolve) => setImmediate(resolve))
    expect(execute).toHaveBeenCalledTimes(2)
    await expect(joiner).resolves.toEqual(['display_name'])
    rejectFirst(new Error('statement timeout'))

    await expect(owner).rejects.toThrow('statement timeout')
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
