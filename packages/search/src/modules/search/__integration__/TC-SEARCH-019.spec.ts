import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

export const integrationMeta = { dependsOnModules: ['search', 'messages', 'sales'] }

type SearchHit = {
  entityId?: string
  recordId?: string
  presenter?: { title?: string; subtitle?: string } | null
  url?: string | null
}

type SearchResponse = {
  results?: SearchHit[]
}

const MESSAGE_ENTITY = 'messages:message'
const SALES_NOTE_ENTITY = 'sales:sales_note'
const SALES_ADDRESS_ENTITY = 'sales:sales_document_address'
const USER_PASSWORD = 'QaSearch5183!Password'

function decodeJwtSubject(token: string): string {
  const payloadPart = token.split('.')[1] ?? ''
  const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { sub?: unknown }
  if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
    throw new Error('Auth token does not contain user subject')
  }
  return decoded.sub
}

async function searchRecords(
  request: APIRequestContext,
  token: string,
  endpoint: '/api/search/search/global' | '/api/search/search',
  query: string,
  entityType: string,
): Promise<{ status: number; raw: string; results: SearchHit[] }> {
  const params = new URLSearchParams({ q: query, limit: '25', entityTypes: entityType })
  const response = await apiRequest(request, 'GET', `${endpoint}?${params.toString()}`, { token })
  const raw = await response.text()
  let parsed: SearchResponse = {}
  try {
    parsed = raw ? (JSON.parse(raw) as SearchResponse) : {}
  } catch {
    parsed = {}
  }
  return {
    status: response.status(),
    raw,
    results: Array.isArray(parsed.results) ? parsed.results : [],
  }
}

async function waitUntilIndexed(
  request: APIRequestContext,
  token: string,
  query: string,
  entityType: string,
  expectedRecordIds: string[],
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await searchRecords(request, token, '/api/search/search/global', query, entityType)
        if (res.status !== 200) return `status:${res.status}`
        const found = new Set(
          res.results.filter((item) => item.entityId === entityType).map((item) => item.recordId),
        )
        const missing = expectedRecordIds.filter((id) => !found.has(id))
        return missing.length === 0 ? 'ready' : `missing:${missing.join(',')}`
      },
      { timeout: 30_000 },
    )
    .toBe('ready')
}

async function createRestrictedUser(
  request: APIRequestContext,
  adminToken: string,
  scope: { tenantId: string; organizationId: string },
  prefix: string,
  features: string[],
): Promise<{ roleId: string; userId: string; token: string }> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`
  const roleName = `${prefix}-role-${stamp}`
  const email = `${prefix}-${stamp}@example.test`
  const roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features,
    organizations: [scope.organizationId],
  })
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: USER_PASSWORD,
    organizationId: scope.organizationId,
    roles: [roleName],
    name: `${prefix} user`,
  })
  const token = await getAuthToken(request, email, USER_PASSWORD)
  return { roleId, userId, token }
}

/**
 * TC-SEARCH-019: row-aware authorization for messages, sales notes, and sales document addresses (#5183).
 *
 * Creates same-organization allowed and denied records sharing a search term and proves
 * denied titles/snippets never leave GET /api/search/search/global or GET /api/search/search.
 */
test.describe('TC-SEARCH-019: row-aware search authorization for messages and polymorphic sales entities', () => {
  test('messages:message returns only rows where the caller is a permitted participant', async ({ request }) => {
    test.slow()
    let adminToken: string | null = null
    let viewerRoleId: string | null = null
    let viewerUserId: string | null = null
    let allowedMessageId: string | null = null
    let deniedMessageId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const employeeToken = await getAuthToken(request, 'employee')
      const adminCtx = getTokenContext(adminToken)
      const employeeUserId = decodeJwtSubject(employeeToken)
      expect(adminCtx.organizationId, 'admin token must carry an organizationId').toBeTruthy()
      const organizationId = adminCtx.organizationId as string

      const viewer = await createRestrictedUser(
        request,
        adminToken,
        { tenantId: adminCtx.tenantId, organizationId },
        'tc-search-019-msg',
        ['search.global', 'search.view', 'messages.view'],
      )
      viewerRoleId = viewer.roleId
      viewerUserId = viewer.userId

      const stamp = Date.now()
      const sharedToken = `QATCSEARCH019MSG${stamp}`
      const allowedSecret = `ALLOWEDMSG${stamp}`
      const deniedSecret = `DENIEDSECRETMSG${stamp}`

      const allowedRes = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: viewer.userId, type: 'to' }],
          subject: `${sharedToken} ${allowedSecret}`,
          body: `Participant message body ${sharedToken} ${allowedSecret}`,
          sendViaEmail: false,
        },
      })
      expect(allowedRes.status(), 'creating allowed message should return 201').toBe(201)
      allowedMessageId = expectId((await readJsonSafe<{ id?: string }>(allowedRes))?.id, 'allowed message id')

      const deniedRes = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: `${sharedToken} ${deniedSecret}`,
          body: `Private message body ${sharedToken} ${deniedSecret}`,
          sendViaEmail: false,
        },
      })
      expect(deniedRes.status(), 'creating denied message should return 201').toBe(201)
      deniedMessageId = expectId((await readJsonSafe<{ id?: string }>(deniedRes))?.id, 'denied message id')

      // Admin is the sender of both messages, so polling as admin confirms both rows are indexed.
      await waitUntilIndexed(request, adminToken, sharedToken, MESSAGE_ENTITY, [allowedMessageId, deniedMessageId])

      for (const endpoint of ['/api/search/search/global', '/api/search/search'] as const) {
        const res = await searchRecords(request, viewer.token, endpoint, sharedToken, MESSAGE_ENTITY)
        expect(res.status, `${endpoint} should return 200`).toBe(200)
        const returnedIds = res.results.map((item) => item.recordId)
        expect(returnedIds, `${endpoint} must include participant message`).toContain(allowedMessageId)
        expect(returnedIds, `${endpoint} must omit non-participant message`).not.toContain(deniedMessageId)
        expect(res.raw, `${endpoint} must never leak denied message subject or snippet`).not.toContain(deniedSecret)
      }
    } finally {
      if (adminToken && allowedMessageId) {
        await apiRequest(request, 'DELETE', `/api/messages/${encodeURIComponent(allowedMessageId)}`, {
          token: adminToken,
        }).catch(() => undefined)
      }
      if (adminToken && deniedMessageId) {
        await apiRequest(request, 'DELETE', `/api/messages/${encodeURIComponent(deniedMessageId)}`, {
          token: adminToken,
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, viewerUserId)
      await deleteRoleIfExists(request, adminToken, viewerRoleId)
    }
  })

  test('sales:sales_note and sales:sales_document_address enforce per-context order/quote features', async ({
    request,
  }) => {
    test.slow()
    let adminToken: string | null = null
    let quoteRoleId: string | null = null
    let quoteUserId: string | null = null
    let orderRoleId: string | null = null
    let orderUserId: string | null = null
    let orderId: string | null = null
    let quoteId: string | null = null
    let orderNoteId: string | null = null
    let quoteNoteId: string | null = null
    let orderAddressId: string | null = null
    let quoteAddressId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      if (!(await canManageSalesOrders(request, adminToken))) {
        test.skip(true, 'Admin cannot manage sales orders in this environment')
        return
      }
      const adminCtx = getTokenContext(adminToken)
      expect(adminCtx.organizationId, 'admin token must carry an organizationId').toBeTruthy()
      const organizationId = adminCtx.organizationId as string

      const quoteReader = await createRestrictedUser(
        request,
        adminToken,
        { tenantId: adminCtx.tenantId, organizationId },
        'tc-search-019-quote',
        ['search.global', 'search.view', 'sales.quotes.view'],
      )
      quoteRoleId = quoteReader.roleId
      quoteUserId = quoteReader.userId

      const orderReader = await createRestrictedUser(
        request,
        adminToken,
        { tenantId: adminCtx.tenantId, organizationId },
        'tc-search-019-order',
        ['search.global', 'search.view', 'sales.orders.view'],
      )
      orderRoleId = orderReader.roleId
      orderUserId = orderReader.userId

      orderId = await createSalesOrderFixture(request, adminToken)
      quoteId = await createSalesQuoteFixture(request, adminToken)

      const stamp = Date.now()
      const noteToken = `QATCSEARCH019NOTE${stamp}`
      const orderNoteSecret = `ORDERNOTESECRET${stamp}`
      const quoteNoteSecret = `QUOTENOTESECRET${stamp}`

      const addrToken = `QATCSEARCH019ADDR${stamp}`
      const orderAddrSecret = `ORDERADDRSECRET${stamp}`
      const quoteAddrSecret = `QUOTEADDRSECRET${stamp}`

      const orderNoteRes = await apiRequest(request, 'POST', '/api/sales/notes', {
        token: adminToken,
        data: {
          contextType: 'order',
          contextId: orderId,
          orderId,
          body: `${noteToken} ${orderNoteSecret}`,
        },
      })
      expect(orderNoteRes.status(), 'creating order note should return 201').toBe(201)
      orderNoteId = expectId((await readJsonSafe<{ id?: string }>(orderNoteRes))?.id, 'order note id')

      const quoteNoteRes = await apiRequest(request, 'POST', '/api/sales/notes', {
        token: adminToken,
        data: {
          contextType: 'quote',
          contextId: quoteId,
          quoteId,
          body: `${noteToken} ${quoteNoteSecret}`,
        },
      })
      expect(quoteNoteRes.status(), 'creating quote note should return 201').toBe(201)
      quoteNoteId = expectId((await readJsonSafe<{ id?: string }>(quoteNoteRes))?.id, 'quote note id')

      const orderAddrRes = await apiRequest(request, 'POST', '/api/sales/document-addresses', {
        token: adminToken,
        data: {
          documentKind: 'order',
          documentId: orderId,
          name: `${addrToken} ${orderAddrSecret}`,
          addressLine1: `100 ${addrToken} ${orderAddrSecret} Way`,
          city: 'Orderville',
          country: 'US',
        },
      })
      expect(orderAddrRes.status(), 'creating order address should return 201').toBe(201)
      orderAddressId = expectId((await readJsonSafe<{ id?: string }>(orderAddrRes))?.id, 'order address id')

      const quoteAddrRes = await apiRequest(request, 'POST', '/api/sales/document-addresses', {
        token: adminToken,
        data: {
          documentKind: 'quote',
          documentId: quoteId,
          name: `${addrToken} ${quoteAddrSecret}`,
          addressLine1: `200 ${addrToken} ${quoteAddrSecret} Ave`,
          city: 'Quotetown',
          country: 'US',
        },
      })
      expect(quoteAddrRes.status(), 'creating quote address should return 201').toBe(201)
      quoteAddressId = expectId((await readJsonSafe<{ id?: string }>(quoteAddrRes))?.id, 'quote address id')

      await waitUntilIndexed(request, adminToken, noteToken, SALES_NOTE_ENTITY, [orderNoteId, quoteNoteId])
      await waitUntilIndexed(request, adminToken, addrToken, SALES_ADDRESS_ENTITY, [orderAddressId, quoteAddressId])

      for (const endpoint of ['/api/search/search/global', '/api/search/search'] as const) {
        const quoteNotesRes = await searchRecords(request, quoteReader.token, endpoint, noteToken, SALES_NOTE_ENTITY)
        expect(quoteNotesRes.status).toBe(200)
        expect(quoteNotesRes.results.map((item) => item.recordId)).toContain(quoteNoteId)
        expect(quoteNotesRes.results.map((item) => item.recordId)).not.toContain(orderNoteId)
        expect(quoteNotesRes.raw).not.toContain(orderNoteSecret)

        const orderNotesRes = await searchRecords(request, orderReader.token, endpoint, noteToken, SALES_NOTE_ENTITY)
        expect(orderNotesRes.status).toBe(200)
        expect(orderNotesRes.results.map((item) => item.recordId)).toContain(orderNoteId)
        expect(orderNotesRes.results.map((item) => item.recordId)).not.toContain(quoteNoteId)
        expect(orderNotesRes.raw).not.toContain(quoteNoteSecret)

        const quoteAddrSearch = await searchRecords(request, quoteReader.token, endpoint, addrToken, SALES_ADDRESS_ENTITY)
        expect(quoteAddrSearch.status).toBe(200)
        expect(quoteAddrSearch.results.map((item) => item.recordId)).toContain(quoteAddressId)
        expect(quoteAddrSearch.results.map((item) => item.recordId)).not.toContain(orderAddressId)
        expect(quoteAddrSearch.raw).not.toContain(orderAddrSecret)

        const orderAddrSearch = await searchRecords(request, orderReader.token, endpoint, addrToken, SALES_ADDRESS_ENTITY)
        expect(orderAddrSearch.status).toBe(200)
        expect(orderAddrSearch.results.map((item) => item.recordId)).toContain(orderAddressId)
        expect(orderAddrSearch.results.map((item) => item.recordId)).not.toContain(quoteAddressId)
        expect(orderAddrSearch.raw).not.toContain(quoteAddrSecret)
      }
    } finally {
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/notes', orderNoteId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/notes', quoteNoteId)
      if (adminToken && orderAddressId && orderId) {
        await apiRequest(request, 'DELETE', '/api/sales/document-addresses', {
          token: adminToken,
          data: { id: orderAddressId, documentId: orderId, documentKind: 'order' },
        }).catch(() => undefined)
      }
      if (adminToken && quoteAddressId && quoteId) {
        await apiRequest(request, 'DELETE', '/api/sales/document-addresses', {
          token: adminToken,
          data: { id: quoteAddressId, documentId: quoteId, documentKind: 'quote' },
        }).catch(() => undefined)
      }
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/quotes', quoteId)
      await deleteUserIfExists(request, adminToken, quoteUserId)
      await deleteRoleIfExists(request, adminToken, quoteRoleId)
      await deleteUserIfExists(request, adminToken, orderUserId)
      await deleteRoleIfExists(request, adminToken, orderRoleId)
    }
  })
})
