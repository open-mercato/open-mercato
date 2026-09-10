import { buildIndexDocument } from '../lib/document'
import { resolveSearchConfig, stripBlocklistedDocFields } from '@open-mercato/shared/lib/search/config'
import { encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

const INTERACTION = 'customers:customer_interaction'
const USER = 'auth:user'

const BCRYPT = '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345'
const SESSION_TOKEN = 'sess_7c41f0ab9d2e4f10'

const originalBlocklist = process.env.OM_SEARCH_FIELD_BLOCKLIST

afterEach(() => {
  if (originalBlocklist === undefined) delete process.env.OM_SEARCH_FIELD_BLOCKLIST
  else process.env.OM_SEARCH_FIELD_BLOCKLIST = originalBlocklist
})

describe('the stored index document no longer carries blocklisted fields', () => {
  it('removes a credential column outright, not merely from the aggregate', () => {
    // The distinction this change exists for. #4624 kept the value out of
    // `search_text` and out of `search_tokens`; `doc ? 'password_hash'` stayed
    // true and the value was the bcrypt verifier in full.
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const doc = buildIndexDocument(
      { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', password_hash: BCRYPT },
      [],
      {},
      { entityType: USER },
    )
    expect(Object.prototype.hasOwnProperty.call(doc, 'password_hash')).toBe(false)
    expect(JSON.stringify(doc)).not.toContain(BCRYPT)
  })

  it.each([
    ['password', 'password_hash', BCRYPT],
    ['token', 'session_token', SESSION_TOKEN],
    ['secret', 'session_secret_encrypted', 'enc_v1_9f13c7'],
    ['hash', 'key_hash', 'deadbeefdeadbeef'],
  ])('%s — %s is removed, and the display field is not', (_pattern, key, value) => {
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const doc = buildIndexDocument({ id: 'x1', name: 'Display me', [key]: value }, [], {}, { entityType: USER })
    expect(Object.prototype.hasOwnProperty.call(doc, key)).toBe(false)
    expect(doc.name).toBe('Display me')
  })

  it('leaves an ordinary document completely untouched', () => {
    // The broadest negative control: if this fails, the strip has grown a
    // condition that is not the blocklist.
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const row = {
      id: 'c1',
      name: 'Acme Ltd',
      status: 'active',
      created_at: '2026-08-28T10:00:00.000Z',
      tenant_id: 't1',
      organization_id: 'o1',
    }
    const doc = buildIndexDocument({ ...row }, [], {}, { entityType: 'customers:customer_company_profile' })
    for (const [key, value] of Object.entries(row)) expect(doc[key]).toEqual(value)
  })

  it('does not change the aggregate, which already excluded these fields', () => {
    // This change is purely about what is STORED. If `search_text` moves, the
    // change is altering search behaviour on the sly.
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const doc = buildIndexDocument(
      { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', password_hash: BCRYPT },
      [],
      {},
      { entityType: USER },
    )
    expect(doc.search_text).toBe('Ada Lovelace\nada@example.com')
  })

  it('honours an added global entry from the environment', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'pin_code'
    const doc = buildIndexDocument({ id: 'd1', label: 'Front door', pin_code: '4821' }, [], {}, { entityType: 'devices:user_device' })
    expect(Object.prototype.hasOwnProperty.call(doc, 'pin_code')).toBe(false)
    expect(doc.label).toBe('Front door')
  })
})

describe('the strip is deliberately narrower than the tokeniser', () => {
  it('ignores entity-scoped entries, which mark volume rather than secrecy', () => {
    // `customers:customer_interaction@body` is the recipe `parseFieldBlocklist`
    // documents, and `customers`' own `formatResult` builds an interaction's
    // subtitle from `record.body` — which `packages/search`'s presenter enricher
    // reads out of `doc`. Honouring the scoped entry here would blank that
    // subtitle in global search. Tokens and the aggregate still drop the field;
    // see `search-field-blocklist.test.ts`.
    process.env.OM_SEARCH_FIELD_BLOCKLIST = `${INTERACTION}@body`
    const doc = buildIndexDocument(
      { id: 'i1', subject: 'Quarterly review', body: 'Long email text' },
      [],
      {},
      { entityType: INTERACTION },
    )
    expect(doc.body).toBe('Long email text')
    expect(String(doc.search_text ?? '')).not.toContain('Long email text')
  })

  it('is bounded by the configured list — `credential` is not on it', () => {
    // One list, one matcher. Widening the strip alone would break the agreement
    // between the aggregate, the token path and this. Set
    // `OM_SEARCH_FIELD_BLOCKLIST=credential` or change `DEFAULT_BLOCKLIST`.
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const doc = buildIndexDocument({ id: 'c1', title: 'Vendor', credentials: 'user:pass@host' }, [], {}, { entityType: 'integrations:integration' })
    expect(doc.credentials).toBe('user:pass@host')
  })
})

describe('stripBlocklistedDocFields keeps the keys the document is the only store for', () => {
  it('keeps cf: and l10n: keys even when their name matches', () => {
    // A base column is re-read from the base table on every query, so dropping
    // it from `doc` costs nothing. Custom fields and translations are read back
    // OUT of `doc`, so stripping them is real data loss.
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const stripped = stripBlocklistedDocFields({
      id: 'p1',
      'cf:password_hint': 'the usual one',
      'l10n:pl:token_label': 'Token dostępu',
      password_hash: BCRYPT,
    })
    expect(stripped['cf:password_hint']).toBe('the usual one')
    expect(stripped['l10n:pl:token_label']).toBe('Token dostępu')
    expect(Object.prototype.hasOwnProperty.call(stripped, 'password_hash')).toBe(false)
  })

  it('reaches custom fields through buildIndexDocument without stripping them', () => {
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const doc = buildIndexDocument(
      { id: 'u1', name: 'Ada', password_hash: BCRYPT },
      [{ key: 'password_hint', value: 'the usual one' }],
      {},
      { entityType: USER },
    )
    expect(doc['cf:password_hint']).toBe('the usual one')
    expect(Object.prototype.hasOwnProperty.call(doc, 'password_hash')).toBe(false)
    // The custom field is kept in the document but stays out of the aggregate.
    expect(String(doc.search_text ?? '')).not.toContain('the usual one')
  })

  it('mutates in place and returns the same object', () => {
    const doc: Record<string, unknown> = { id: 'u1', token: SESSION_TOKEN }
    const returned = stripBlocklistedDocFields(doc, resolveSearchConfig())
    expect(returned).toBe(doc)
    expect(Object.prototype.hasOwnProperty.call(doc, 'token')).toBe(false)
  })

  // An earlier draft of this change claimed, in four documents, that a column named by an
  // encryption rule's `hashField` survives the strip because `encryptIndexDocForStorage()`
  // re-injects it afterwards. It does not, and no gate could see the difference: the claim
  // lived only in prose while the outcome lived in a `continue` two packages away. These two
  // cases pin the outcome and the mechanism, so the prose cannot drift from the code again.
  it('strips a `hashField` column like any other blocklisted match', () => {
    delete process.env.OM_SEARCH_FIELD_BLOCKLIST
    const doc = buildIndexDocument(
      { id: 'u1', name: 'Ada', email: 'sealed-ciphertext', email_hash: 'deadbeef' },
      [],
      {},
      { entityType: USER },
    )
    expect(Object.prototype.hasOwnProperty.call(doc, 'email_hash')).toBe(false)
    // The base column itself is not blocklisted, so it stays - only the hash matches.
    expect(doc.email).toBe('sealed-ciphertext')
  })

  it('does not re-inject the hash for an already-sealed value, which is the steady state', () => {
    // `buildIndexDoc()` reads the base row raw and the encryption subscriber has already
    // encrypted on flush, so by the time `encryptIndexDocForStorage()` runs the column IS
    // ciphertext. `encryptFields()` skips a value that decrypts under the current DEK, and
    // that `continue` precedes the `hashField` block - so the hash is never written back.
    const key = Buffer.alloc(32, 1).toString('base64')
    const service = new TenantDataEncryptionService({} as never) as unknown as {
      encryptFields: (
        obj: Record<string, unknown>,
        fields: { field: string; hashField?: string | null }[],
        dek: { key: string },
      ) => Record<string, unknown>
    }
    const alreadySealed = encryptWithAesGcm('ada@example.com', key).value as string

    const out = service.encryptFields(
      { id: 'u1', email: alreadySealed },
      [{ field: 'email', hashField: 'email_hash' }],
      { key } as never,
    )

    expect(out.email).toBe(alreadySealed)
    expect(out.email_hash).toBeUndefined()
  })
})
