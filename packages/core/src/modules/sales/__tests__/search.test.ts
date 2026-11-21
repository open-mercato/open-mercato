import type { SearchResult, SearchResultVisibilityContext } from '@open-mercato/shared/modules/search'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesDocumentAddress, SalesNote } from '../data/entities'
import searchConfig, {
  filterVisibleSalesDocumentAddresses,
  filterVisibleSalesNotes,
} from '../search'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222299'
const USER_ID = '33333333-3333-4333-8333-333333333331'

const ORDER_ROW_ID = '44444444-4444-4444-8444-444444444401'
const QUOTE_ROW_ID = '44444444-4444-4444-8444-444444444402'
const INVOICE_ROW_ID = '44444444-4444-4444-8444-444444444403'
const CREDIT_MEMO_ROW_ID = '44444444-4444-4444-8444-444444444404'
const UNKNOWN_KIND_ROW_ID = '44444444-4444-4444-8444-444444444405'
const OTHER_ORG_ROW_ID = '44444444-4444-4444-8444-444444444406'

const mockedFindWithDecryption = findWithDecryption as jest.Mock

function makeResult(entityId: string, recordId: string, organizationId: string | null = ORG_ID): SearchResult {
  return { entityId, recordId, score: 1, source: 'fulltext', organizationId }
}

function makeCtx(options: {
  entityId: 'sales:sales_note' | 'sales:sales_document_address'
  results: SearchResult[]
  rows?: Array<Record<string, unknown>>
  loadAcl?: jest.Mock
  authOverrides?: Partial<SearchResultVisibilityContext['viewer']['auth']>
  organizationId?: string | null
  organizationIds?: string[] | null
  omitContainer?: boolean
  omitRbac?: boolean
}) {
  mockedFindWithDecryption.mockResolvedValue(options.rows ?? [])
  const loadAcl = options.loadAcl ?? jest.fn().mockResolvedValue({
    isSuperAdmin: false,
    features: [],
    organizations: [ORG_ID],
  })
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return {}
      if (name === 'rbacService') {
        if (options.omitRbac) return undefined
        return { loadAcl }
      }
      throw new Error(`Unexpected resolve: ${name}`)
    },
  }
  const ctx: SearchResultVisibilityContext = {
    entityId: options.entityId,
    results: options.results,
    tenantId: TENANT_ID,
    organizationId: options.organizationId !== undefined ? options.organizationId : ORG_ID,
    organizationIds: options.organizationIds !== undefined ? options.organizationIds : [ORG_ID],
    viewer: {
      auth: {
        sub: USER_ID,
        userId: USER_ID,
        tenantId: TENANT_ID,
        orgId: ORG_ID,
        isSuperAdmin: false,
        ...options.authOverrides,
      },
      container: options.omitContainer ? undefined : container,
    },
  }
  return { ctx, loadAcl }
}

describe('sales polymorphic search config', () => {
  it('configures aclFeaturesMode "any" and filterResults on sales_note and sales_document_address', () => {
    const expectedFeatures = [
      'sales.orders.view',
      'sales.quotes.view',
      'sales.invoices.manage',
      'sales.credit_memos.manage',
    ]
    const note = searchConfig.entities.find((entry) => entry.entityId === 'sales:sales_note')
    const address = searchConfig.entities.find((entry) => entry.entityId === 'sales:sales_document_address')

    expect(note?.aclFeatures).toEqual(expectedFeatures)
    expect(note?.aclFeaturesMode).toBe('any')
    expect(note?.filterResults).toBe(filterVisibleSalesNotes)

    expect(address?.aclFeatures).toEqual(expectedFeatures)
    expect(address?.aclFeaturesMode).toBe('any')
    expect(address?.filterResults).toBe(filterVisibleSalesDocumentAddresses)
  })
})

describe('filterVisibleSalesNotes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    ['order', 'sales.orders.view', ORDER_ROW_ID],
    ['quote', 'sales.quotes.view', QUOTE_ROW_ID],
    ['invoice', 'sales.invoices.manage', INVOICE_ROW_ID],
    ['credit_memo', 'sales.credit_memos.manage', CREDIT_MEMO_ROW_ID],
  ] as const)(
    'returns only %s notes when caller holds %s and memoizes loadAcl per org',
    async (_kind, feature, expectedId) => {
      const results = [
        makeResult('sales:sales_note', ORDER_ROW_ID),
        makeResult('sales:sales_note', QUOTE_ROW_ID),
        makeResult('sales:sales_note', INVOICE_ROW_ID),
        makeResult('sales:sales_note', CREDIT_MEMO_ROW_ID),
        makeResult('sales:sales_note', UNKNOWN_KIND_ROW_ID),
      ]
      const loadAcl = jest.fn().mockResolvedValue({
        isSuperAdmin: false,
        features: [feature],
        organizations: [ORG_ID],
      })
      const { ctx } = makeCtx({
        entityId: 'sales:sales_note',
        results,
        loadAcl,
        rows: [
          { id: ORDER_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'order' },
          { id: QUOTE_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'quote' },
          { id: INVOICE_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'invoice' },
          { id: CREDIT_MEMO_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'credit_memo' },
          { id: UNKNOWN_KIND_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'mystery' },
        ],
      })

      const visible = await filterVisibleSalesNotes(ctx)

      expect(visible.map((r) => r.recordId)).toEqual([expectedId])
      expect(loadAcl).toHaveBeenCalledTimes(1)
      expect(loadAcl).toHaveBeenCalledWith(USER_ID, { tenantId: TENANT_ID, organizationId: ORG_ID })
      expect(mockedFindWithDecryption).toHaveBeenCalledWith(
        expect.anything(),
        SalesNote,
        {
          id: { $in: [ORDER_ROW_ID, QUOTE_ROW_ID, INVOICE_ROW_ID, CREDIT_MEMO_ROW_ID, UNKNOWN_KIND_ROW_ID] },
          tenantId: TENANT_ID,
          deletedAt: null,
        },
        { fields: ['id', 'tenantId', 'organizationId', 'contextType'] },
        { tenantId: TENANT_ID, organizationId: ORG_ID },
      )
    },
  )

  it('enforces live RBAC isSuperAdmin and organizations rather than trusting stale JWT claims', async () => {
    const rOrder = makeResult('sales:sales_note', ORDER_ROW_ID)
    const staleJwtCtx = makeCtx({
      entityId: 'sales:sales_note',
      results: [rOrder],
      authOverrides: { isSuperAdmin: true },
      loadAcl: jest.fn().mockResolvedValue({
        isSuperAdmin: false,
        features: [],
        organizations: [ORG_ID],
      }),
      rows: [{ id: ORDER_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'order' }],
    })
    expect(await filterVisibleSalesNotes(staleJwtCtx.ctx)).toEqual([])

    const revokedOrgCtx = makeCtx({
      entityId: 'sales:sales_note',
      results: [rOrder],
      loadAcl: jest.fn().mockResolvedValue({
        isSuperAdmin: false,
        features: ['sales.orders.view'],
        organizations: [OTHER_ORG_ID],
      }),
      rows: [{ id: ORDER_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'order' }],
    })
    expect(await filterVisibleSalesNotes(revokedOrgCtx.ctx)).toEqual([])

    const liveSuperCtx = makeCtx({
      entityId: 'sales:sales_note',
      results: [rOrder],
      loadAcl: jest.fn().mockResolvedValue({
        isSuperAdmin: true,
        features: [],
        organizations: null,
      }),
      rows: [{ id: ORDER_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'order' }],
    })
    expect(await filterVisibleSalesNotes(liveSuperCtx.ctx)).toEqual([rOrder])
  })

  it('evaluates delegated API-key subjects through rbacService.loadAcl and rejects non-UUID subjects', async () => {
    const apiKeyId = '55555555-5555-4555-8555-555555555577'
    const apiKeySub = `api_key:${apiKeyId}`
    const rQuote = makeResult('sales:sales_note', QUOTE_ROW_ID)
    const rOrder = makeResult('sales:sales_note', ORDER_ROW_ID)
    const loadAcl = jest.fn().mockResolvedValue({
      isSuperAdmin: false,
      features: ['sales.quotes.view'],
      organizations: [ORG_ID],
    })
    const { ctx } = makeCtx({
      entityId: 'sales:sales_note',
      results: [rOrder, rQuote],
      authOverrides: { sub: apiKeySub, userId: undefined, isApiKey: true, keyId: apiKeyId },
      loadAcl,
      rows: [
        { id: ORDER_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'order' },
        { id: QUOTE_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'quote' },
      ],
    })

    expect(await filterVisibleSalesNotes(ctx)).toEqual([rQuote])
    expect(loadAcl).toHaveBeenCalledWith(apiKeySub, { tenantId: TENANT_ID, organizationId: ORG_ID })

    jest.clearAllMocks()
    const badUserSub = makeCtx({
      entityId: 'sales:sales_note',
      results: [rQuote],
      authOverrides: { sub: 'not-a-uuid', userId: undefined },
    })
    expect(await filterVisibleSalesNotes(badUserSub.ctx)).toEqual([])
    expect(mockedFindWithDecryption).not.toHaveBeenCalled()

    const badApiKeySub = makeCtx({
      entityId: 'sales:sales_note',
      results: [rQuote],
      authOverrides: { sub: 'api_key:not-a-uuid', userId: undefined, isApiKey: true, keyId: 'not-a-uuid' },
    })
    expect(await filterVisibleSalesNotes(badApiKeySub.ctx)).toEqual([])
    expect(mockedFindWithDecryption).not.toHaveBeenCalled()

    const staleCrossTenantJwt = makeCtx({
      entityId: 'sales:sales_note',
      results: [rQuote],
      authOverrides: { tenantId: '99999999-9999-4999-8999-999999999999', isSuperAdmin: true },
      loadAcl: jest.fn().mockResolvedValue({
        isSuperAdmin: false,
        features: ['sales.quotes.view'],
        organizations: [ORG_ID],
      }),
      rows: [{ id: QUOTE_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'quote' }],
    })
    expect(await filterVisibleSalesNotes(staleCrossTenantJwt.ctx)).toEqual([])
  })

  it('sanitizes non-UUID recordIds, enforces DB-row organization scope, and fails closed on missing services', async () => {
    const rQuote = makeResult('sales:sales_note', QUOTE_ROW_ID)
    const rBadId = makeResult('sales:sales_note', 'not-a-uuid')
    const rOtherOrg = makeResult('sales:sales_note', OTHER_ORG_ROW_ID, ORG_ID)
    const { ctx } = makeCtx({
      entityId: 'sales:sales_note',
      results: [rQuote, rBadId, rOtherOrg],
      loadAcl: jest.fn().mockResolvedValue({
        isSuperAdmin: false,
        features: ['sales.*'],
        organizations: [ORG_ID, OTHER_ORG_ID],
      }),
      rows: [
        { id: QUOTE_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, contextType: 'quote' },
        { id: OTHER_ORG_ROW_ID, tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, contextType: 'quote' },
      ],
    })
    expect(await filterVisibleSalesNotes(ctx)).toEqual([rQuote])

    const emptyOrgCtx = makeCtx({
      entityId: 'sales:sales_note',
      results: [rQuote],
      organizationId: null,
      organizationIds: [],
    })
    expect(await filterVisibleSalesNotes(emptyOrgCtx.ctx)).toEqual([])

    const missingContainer = makeCtx({ entityId: 'sales:sales_note', results: [rQuote], omitContainer: true })
    await expect(filterVisibleSalesNotes(missingContainer.ctx)).rejects.toThrow(/requires a request container/)

    const missingRbac = makeCtx({ entityId: 'sales:sales_note', results: [rQuote], omitRbac: true })
    await expect(filterVisibleSalesNotes(missingRbac.ctx)).rejects.toThrow(/requires rbacService/)
  })
})

describe('filterVisibleSalesDocumentAddresses', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    ['order', 'sales.orders.view', ORDER_ROW_ID],
    ['quote', 'sales.quotes.view', QUOTE_ROW_ID],
    ['invoice', 'sales.invoices.manage', INVOICE_ROW_ID],
    ['credit_memo', 'sales.credit_memos.manage', CREDIT_MEMO_ROW_ID],
  ] as const)(
    'returns only %s document addresses when caller holds %s',
    async (_kind, feature, expectedId) => {
      const results = [
        makeResult('sales:sales_document_address', ORDER_ROW_ID),
        makeResult('sales:sales_document_address', QUOTE_ROW_ID),
        makeResult('sales:sales_document_address', INVOICE_ROW_ID),
        makeResult('sales:sales_document_address', CREDIT_MEMO_ROW_ID),
        makeResult('sales:sales_document_address', UNKNOWN_KIND_ROW_ID),
      ]
      const { ctx } = makeCtx({
        entityId: 'sales:sales_document_address',
        results,
        loadAcl: jest.fn().mockResolvedValue({
          isSuperAdmin: false,
          features: [feature],
          organizations: [ORG_ID],
        }),
        rows: [
          { id: ORDER_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, documentKind: 'order' },
          { id: QUOTE_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, documentKind: 'quote' },
          { id: INVOICE_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, documentKind: 'invoice' },
          { id: CREDIT_MEMO_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, documentKind: 'credit_memo' },
          { id: UNKNOWN_KIND_ROW_ID, tenantId: TENANT_ID, organizationId: ORG_ID, documentKind: null },
        ],
      })

      const visible = await filterVisibleSalesDocumentAddresses(ctx)

      expect(visible.map((r) => r.recordId)).toEqual([expectedId])
      expect(mockedFindWithDecryption).toHaveBeenCalledWith(
        expect.anything(),
        SalesDocumentAddress,
        {
          id: { $in: [ORDER_ROW_ID, QUOTE_ROW_ID, INVOICE_ROW_ID, CREDIT_MEMO_ROW_ID, UNKNOWN_KIND_ROW_ID] },
          tenantId: TENANT_ID,
          deletedAt: null,
        },
        { fields: ['id', 'tenantId', 'organizationId', 'documentKind'] },
        { tenantId: TENANT_ID, organizationId: ORG_ID },
      )
    },
  )
})
