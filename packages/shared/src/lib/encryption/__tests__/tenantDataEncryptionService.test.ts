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

    let emitted: Record<string, unknown> | null = null
    try {
      emitted = service.encryptFields(
        { email: sealedUnderPreviousDek, email_hash: hashForLookup('mail@example.com') },
        [{ field: 'email', hashField: 'email_hash' }],
        { key: fixedKey } as never,
      )
    } catch {
      emitted = null
    }

    // Before the fix this returned a writable payload; assert on that payload rather than on
    // the (always-cloned, therefore always-untouched) input, so the test fails without the fix.
    expect(emitted).toBeNull()

    // Spell out what that payload used to contain, so the regression is legible: one more
    // AES-GCM layer whose plaintext is the previous envelope, and a lookup hash computed over
    // ciphertext instead of over the email — neither of which any read path can undo.
    const nested = encryptWithAesGcm(sealedUnderPreviousDek, fixedKey).value as string
    expect(decryptWithAesGcm(nested, fixedKey)).toBe(sealedUnderPreviousDek)
    expect(hashForLookup(sealedUnderPreviousDek)).not.toBe(hashForLookup('mail@example.com'))
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

describe('TenantDataEncryptionService.getEncryptedFieldNames', () => {
  it('returns active encryption-map field names for query planning', async () => {
    const service = new TenantDataEncryptionService({} as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)
    ;(service as unknown as {
      getMap: () => Promise<{ fields: Array<{ field?: unknown }> }>
    }).getMap = jest.fn(async () => ({
      fields: [
        { field: 'display_name' },
        { field: 'primary_email' },
        { field: '' },
        { field: null },
      ],
    }))

    await expect(
      service.getEncryptedFieldNames('customers:customer_entity', 't1', 'org1'),
    ).resolves.toEqual(['display_name', 'primary_email'])
  })

  it('returns org-scoped field union for all-organization query planning', async () => {
    const execute = jest.fn(async (_sql: string, params: unknown[]) => {
      if (params.length === 3) return []
      return [
        { fields_json: [{ field: 'display_name' }, { field: 'primary_email' }] },
        { fields_json: [{ field: 'display_name' }, { field: 'description' }, { field: '' }] },
      ]
    })
    const service = new TenantDataEncryptionService({
      getConnection: () => ({ execute }),
    } as never)
    jest.spyOn(service, 'isEnabled').mockReturnValue(true)

    await expect(
      service.getEncryptedFieldNames('test:all_org_customer_entity', 'tenant-all', null),
    ).resolves.toEqual(['display_name', 'primary_email', 'description'])

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('organization_id is not null'),
      ['test:all_org_customer_entity', 'tenant-all'],
    )
  })
})
