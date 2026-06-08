import { decryptWithAesGcm, encryptWithAesGcm, hashForLookup } from '../aes'
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

  it('encrypts a structurally-valid payload that was sealed with a different key', () => {
    const service = makeService()
    const otherKey = Buffer.alloc(32, 2).toString('base64')
    const sealedElsewhere = encryptWithAesGcm('secret', otherKey).value as string
    const out = service.encryptFields(
      { email: sealedElsewhere },
      [{ field: 'email' }],
      { key: fixedKey } as never,
    )
    expect(out.email).not.toBe(sealedElsewhere)
    expect(decryptWithAesGcm(out.email as string, fixedKey)).toBe(sealedElsewhere)
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
})
