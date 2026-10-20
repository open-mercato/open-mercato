import { attachAggregateSearchField, rebuildAggregateSearchField } from '../lib/document'
import { replaceSearchTokensForBatch, replaceSearchTokensForRecord } from '../lib/search-tokens'
import { reindexSearchTokensForRecord } from '../lib/indexer'
import { upsertIndexBatch, type AnyRow } from '../lib/batch'

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn(async () => undefined),
}))

jest.mock('../lib/search-tokens', () => ({
  replaceSearchTokensForRecord: jest.fn(async () => undefined),
  replaceSearchTokensForBatch: jest.fn(async () => undefined),
  deleteSearchTokensForRecord: jest.fn(async () => undefined),
  isSearchDebugEnabled: () => false,
}))

const PERSON = 'customers:customer_person_profile'

// Shaped like the `<iv>:<ct>:<tag>:v1` values `entity_indexes.doc` holds at rest for a field
// an encryption map covers. Nothing decrypts it here; the tests only need a token-bearing
// string that a user could never type into a search box.
const CIPHERTEXT_NAME = 'a1b2c3d4:9f8e7d6c5b4a:112233445566:v1'
const PLAINTEXT_NAME = 'Ada Lovelace'

const mockReplaceForRecord = replaceSearchTokensForRecord as jest.MockedFunction<typeof replaceSearchTokensForRecord>
const mockReplaceForBatch = replaceSearchTokensForBatch as jest.MockedFunction<typeof replaceSearchTokensForBatch>

const originalBlocklist = process.env.OM_SEARCH_FIELD_BLOCKLIST

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  if (originalBlocklist === undefined) delete process.env.OM_SEARCH_FIELD_BLOCKLIST
  else process.env.OM_SEARCH_FIELD_BLOCKLIST = originalBlocklist
})

describe('rebuildAggregateSearchField', () => {
  it('replaces an aggregate composed from ciphertext with the decrypted values', () => {
    const decrypted = {
      id: 'rec-1',
      display_name: PLAINTEXT_NAME,
      search_text: CIPHERTEXT_NAME,
    }

    const rebuilt = rebuildAggregateSearchField(decrypted, { entityType: PERSON })

    expect(rebuilt.search_text).toBe(PLAINTEXT_NAME)
    expect(rebuilt.search_text).not.toContain(CIPHERTEXT_NAME)
  })

  it('leaves the caller document untouched so the stored row keeps its encrypted aggregate', () => {
    // The caller's own object goes in, so the case fails if the shallow copy is ever
    // dropped: a mutating implementation would rewrite `stored.search_text` in place.
    const stored = { id: 'rec-1', display_name: PLAINTEXT_NAME, search_text: CIPHERTEXT_NAME }

    const rebuilt = rebuildAggregateSearchField(stored, { entityType: PERSON })

    expect(rebuilt.search_text).toBe(PLAINTEXT_NAME)
    expect(stored.search_text).toBe(CIPHERTEXT_NAME)
    expect(rebuilt).not.toBe(stored)
  })

  it('keeps a blocklisted field out of the rebuilt aggregate', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'secret_note'

    const rebuilt = rebuildAggregateSearchField(
      {
        id: 'rec-1',
        display_name: PLAINTEXT_NAME,
        secret_note: 'Confidential decrypted note',
        search_text: CIPHERTEXT_NAME,
      },
      { entityType: PERSON },
    )

    expect(rebuilt.search_text).toContain(PLAINTEXT_NAME)
    expect(rebuilt.search_text).not.toContain('Confidential decrypted note')
  })

  it('blanks a stale aggregate when every remaining field is blocklisted', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'display_name'

    const rebuilt = rebuildAggregateSearchField(
      { id: 'rec-1', display_name: PLAINTEXT_NAME, search_text: CIPHERTEXT_NAME },
      { entityType: PERSON },
    )

    // Blank, not absent: an empty value yields no tokens, while keeping the key on the
    // document so `replaceSearchTokensForRecord` — which scopes its DELETE to the
    // document's own field names — still removes the ciphertext-derived rows.
    expect(rebuilt.search_text).toBe('')
    expect('search_text' in rebuilt).toBe(true)
  })

  it('leaves a document that never carried an aggregate without the key', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'display_name'

    const rebuilt = rebuildAggregateSearchField({ id: 'rec-1', display_name: PLAINTEXT_NAME }, { entityType: PERSON })

    expect('search_text' in rebuilt).toBe(false)
  })
})

describe('attachAggregateSearchField', () => {
  it('leaves an existing aggregate alone when nothing survives the blocklist', () => {
    process.env.OM_SEARCH_FIELD_BLOCKLIST = 'display_name'

    // The blanking special case belongs to the rebuild path alone. This shared export is
    // reached by `buildIndexDocument` and `buildIndexDoc` too, so it keeps its original
    // contract for every caller inside and outside this repository.
    const doc = attachAggregateSearchField(
      { id: 'rec-1', display_name: PLAINTEXT_NAME, search_text: CIPHERTEXT_NAME },
      { entityType: PERSON },
    )

    expect(doc.search_text).toBe(CIPHERTEXT_NAME)
  })
})

describe('reindexSearchTokensForRecord', () => {
  it('tokenizes the aggregate from the decrypted document, not from the stored ciphertext', async () => {
    const em = { getKysely: () => ({}) } as any

    await reindexSearchTokensForRecord(em, {
      entityType: PERSON,
      recordId: 'rec-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      doc: { id: 'rec-1', display_name: CIPHERTEXT_NAME, search_text: CIPHERTEXT_NAME },
      searchTokenDoc: { id: 'rec-1', display_name: PLAINTEXT_NAME, search_text: CIPHERTEXT_NAME },
    })

    expect(mockReplaceForRecord).toHaveBeenCalledTimes(1)
    const tokenDoc = mockReplaceForRecord.mock.calls[0][1].doc as Record<string, unknown>
    expect(tokenDoc.search_text).toBe(PLAINTEXT_NAME)
  })

  it('rebuilds on the decrypted copy without mutating the caller document when no searchTokenDoc is passed', async () => {
    // The path every real write takes: nothing in the repository populates `searchTokenDoc`,
    // so production always goes through the decrypt. `resolveTenantEncryptionService` is
    // mocked to null here, which makes `decryptIndexDocForSearch` return the very object it
    // was given — and that object is the one `upsertIndexRow` hands back to its caller. An
    // in-place rebuild would therefore leak a plaintext aggregate into the stored document.
    const em = { getKysely: () => ({}) } as any
    const doc = { id: 'rec-1', display_name: PLAINTEXT_NAME, search_text: CIPHERTEXT_NAME }

    await reindexSearchTokensForRecord(em, {
      entityType: PERSON,
      recordId: 'rec-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      doc,
    })

    expect(mockReplaceForRecord).toHaveBeenCalledTimes(1)
    const tokenDoc = mockReplaceForRecord.mock.calls[0][1].doc as Record<string, unknown>
    expect(tokenDoc.search_text).toBe(PLAINTEXT_NAME)
    expect(doc.search_text).toBe(CIPHERTEXT_NAME)
    expect(tokenDoc).not.toBe(doc)
  })

  it('resolves the search config once and threads it into the token writer', async () => {
    // The aggregate's blocklist filter and the per-field token filter must read one
    // snapshot of the environment, as the batch path already guarantees. Passing the
    // resolved config through makes that structural rather than incidental — and saves
    // `resolveSearchConfig` re-parsing eleven env vars a second time on a hot write path.
    const em = { getKysely: () => ({}) } as any

    await reindexSearchTokensForRecord(em, {
      entityType: PERSON,
      recordId: 'rec-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      doc: { id: 'rec-1', display_name: PLAINTEXT_NAME },
    })

    expect(mockReplaceForRecord.mock.calls[0][1].config).toBeDefined()
  })
})

describe('upsertIndexBatch', () => {
  function createFakeDb() {
    const selectChain = (): any => {
      const chain: any = {
        select: () => chain,
        selectAll: () => chain,
        where: () => chain,
        execute: async () => [],
        executeTakeFirst: async () => undefined,
      }
      return chain
    }

    const insertChain = (): any => {
      const chain: any = {
        values: () => chain,
        onConflict: (cb: unknown) => {
          if (typeof cb === 'function') {
            const oc: any = { columns: () => oc, doUpdateSet: () => oc, doNothing: () => oc }
            ;(cb as (builder: any) => unknown)(oc)
          }
          return chain
        },
        execute: async () => [],
      }
      return chain
    }

    return {
      selectFrom: () => selectChain(),
      insertInto: () => insertChain(),
      updateTable: () => selectChain(),
      deleteFrom: () => selectChain(),
    } as any
  }

  it('rebuilds the aggregate on the decrypted copy and keeps the stored document encrypted', async () => {
    const rows: AnyRow[] = [{
      id: 'rec-1',
      display_name: CIPHERTEXT_NAME,
      organization_id: 'org-1',
      tenant_id: 'tenant-1',
    }]
    const storedDocs: Array<Record<string, unknown>> = []

    await upsertIndexBatch(createFakeDb(), PERSON, rows, { orgId: 'org-1', tenantId: 'tenant-1' }, {
      decryptDoc: async (_entityType, doc) => {
        storedDocs.push(doc)
        return { ...doc, display_name: PLAINTEXT_NAME }
      },
    })

    expect(mockReplaceForBatch).toHaveBeenCalledTimes(1)
    const payloads = mockReplaceForBatch.mock.calls[0][1] as Array<{ doc: Record<string, unknown> }>
    expect(payloads).toHaveLength(1)
    expect(payloads[0].doc.search_text).toBe(PLAINTEXT_NAME)

    expect(storedDocs).toHaveLength(1)
    expect(storedDocs[0].search_text).toBe(CIPHERTEXT_NAME)
    expect(storedDocs[0].display_name).toBe(CIPHERTEXT_NAME)
  })

  it('does not tokenize the very object it persists when decryptDoc returns its argument', async () => {
    // `decryptIndexDocForSearch` returns the document it was given when no encryption
    // service is available and the row carries no custom-field keys, so `decrypted === doc`
    // on a reachable configuration — and `doc` is the object serialized into
    // `entity_indexes`. Recomposing the aggregate in place there would write plaintext at
    // rest, which is exactly what the shallow copy exists to prevent.
    const rows: AnyRow[] = [{
      id: 'rec-1',
      display_name: PLAINTEXT_NAME,
      organization_id: 'org-1',
      tenant_id: 'tenant-1',
    }]
    const storedDocs: Array<Record<string, unknown>> = []

    await upsertIndexBatch(createFakeDb(), PERSON, rows, { orgId: 'org-1', tenantId: 'tenant-1' }, {
      decryptDoc: async (_entityType, doc) => {
        storedDocs.push(doc)
        return doc
      },
    })

    const payloads = mockReplaceForBatch.mock.calls[0][1] as Array<{ doc: Record<string, unknown> }>
    expect(storedDocs).toHaveLength(1)
    expect(payloads[0].doc).not.toBe(storedDocs[0])
  })
})
