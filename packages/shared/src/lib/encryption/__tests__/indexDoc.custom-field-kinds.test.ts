import { decryptIndexDocCustomFields, decryptIndexDocForSearch } from '../indexDoc'
import { encryptCustomFieldValue } from '../customFieldValues'
import { buildCustomFieldKindMap } from '../../custom-fields/kinds'

/**
 * Regression coverage for issue #5968: the query-index and search read paths decrypted
 * `cf:`/`cf_` values without the field's `kind`, so `decryptCustomFieldValue` fell through
 * to `JSON.parse` and retyped every string-typed custom field whose plaintext looked like
 * JSON. Unlike the sibling `indexDoc.test.ts`, this suite does NOT mock
 * `decryptCustomFieldValue` — the defect lives in the argument the helpers pass to it, so a
 * mocked value would hide it.
 */

const fixedKey = Buffer.alloc(32, 7).toString('base64')

const service = {
  isEnabled: () => true,
  getDek: async () => ({ key: fixedKey }),
} as any

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

async function encrypt(value: unknown): Promise<unknown> {
  return encryptCustomFieldValue(value, scope.tenantId, service, new Map())
}

describe('encryption/indexDoc custom field kinds (#5968)', () => {
  it.each([
    ['123', 'text'],
    ['0042', 'multiline'],
    ['true', 'select'],
    ['false', 'text'],
    ['null', 'text'],
    ['{"nested":1}', 'multiline'],
    ['[1,2,3]', 'text'],
    ['1.5e3', 'currency'],
  ])('keeps the string %p verbatim for a %s field', async (plaintext, kind) => {
    const doc = { id: '1', 'cf:note': await encrypt(plaintext) }
    const kinds = buildCustomFieldKindMap([{ key: 'note', kind }])

    const out = await decryptIndexDocCustomFields(doc, scope, service, new Map(), kinds)

    expect(out['cf:note']).toBe(plaintext)
  })

  it('still coerces numeric and boolean kinds through the JSON round trip', async () => {
    const doc = {
      id: '1',
      'cf:count': await encrypt(42),
      'cf:ratio': await encrypt(3.14),
      'cf:flag': await encrypt(true),
    }
    const kinds = buildCustomFieldKindMap([
      { key: 'count', kind: 'integer' },
      { key: 'ratio', kind: 'float' },
      { key: 'flag', kind: 'boolean' },
    ])

    const out = await decryptIndexDocCustomFields(doc, scope, service, new Map(), kinds)

    expect(out['cf:count']).toBe(42)
    expect(out['cf:ratio']).toBe(3.14)
    expect(out['cf:flag']).toBe(true)
  })

  it('applies the kind to every entry of a multi-value field', async () => {
    const doc = { id: '1', 'cf:codes': [await encrypt('1'), await encrypt('2')] }
    const kinds = buildCustomFieldKindMap([{ key: 'codes', kind: 'text' }])

    const out = await decryptIndexDocCustomFields(doc, scope, service, new Map(), kinds)

    expect(out['cf:codes']).toEqual(['1', '2'])
  })

  it('resolves the sanitized `cf_` alias the hybrid query engine emits', async () => {
    // `HybridQueryEngine.sanitize()` turns the doc key `cf:order-ref` into `cf_order_ref`,
    // so a map keyed only by the authored key would miss it.
    const doc = { id: '1', cf_order_ref: await encrypt('900') }
    const kinds = buildCustomFieldKindMap([{ key: 'order-ref', kind: 'text' }])

    const out = await decryptIndexDocCustomFields(doc, scope, service, new Map(), kinds)

    expect(out.cf_order_ref).toBe('900')
  })

  it('falls back to the legacy JSON round trip when the kind cannot be resolved', async () => {
    const doc = { id: '1', 'cf:unknown': await encrypt('123') }

    const withoutMap = await decryptIndexDocCustomFields(doc, scope, service, new Map())
    const withEmptyMap = await decryptIndexDocCustomFields(doc, scope, service, new Map(), {})

    expect(withoutMap['cf:unknown']).toBe(123)
    expect(withEmptyMap['cf:unknown']).toBe(123)
  })

  it('threads the kind map through decryptIndexDocForSearch', async () => {
    const searchService = {
      ...service,
      isEnabled: () => true,
      decryptEntityPayload: async () => ({ title: 'Plain' }),
    } as any
    const doc = { id: '1', title: 'Encrypted', 'cf:note': await encrypt('123') }
    const kinds = buildCustomFieldKindMap([{ key: 'note', kind: 'text' }])

    const out = await decryptIndexDocForSearch('example:todo', doc, scope, searchService, new Map(), kinds)

    expect(out.title).toBe('Plain')
    expect(out['cf:note']).toBe('123')
  })

  it('threads the kind map through decryptIndexDocForSearch without an entity payload decryptor', async () => {
    const doc = { id: '1', 'cf:note': await encrypt('true') }
    const kinds = buildCustomFieldKindMap([{ key: 'note', kind: 'text' }])

    const out = await decryptIndexDocForSearch('example:todo', doc, scope, service, new Map(), kinds)

    expect(out['cf:note']).toBe('true')
  })
})
