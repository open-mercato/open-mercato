import { encryptWithAesGcm } from '../aes'
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
