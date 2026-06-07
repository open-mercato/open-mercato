import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteGeneralEntityIfExists,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { deleteFeatureToggleIfExists } from '@open-mercato/core/helpers/integration/featureTogglesFixtures'

/**
 * TC-UNDO-005: bespoke create-redo handlers restore the original id.
 *
 * This complements the generic makeCreateRedo coverage by exercising hand-written
 * restore logic called out in PR #2552 review feedback:
 * auth.users, customers.companies, customers.interactions,
 * directory.organizations, feature_toggles.global, and sales.returns.
 */

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

type Operation = { id: string; undoToken: string; resourceId: string | null }

function readOperation(res: APIResponse): Operation {
  const header = res.headers()['x-om-operation'] ?? ''
  const enc = header.startsWith('omop:') ? header.slice(5) : ''
  expect(enc, 'x-om-operation header carries an omop: payload').not.toBe('')
  const payload = JSON.parse(decodeURIComponent(enc)) as { id?: string; undoToken?: string; resourceId?: string | null }
  expect(typeof payload.id, 'log id present').toBe('string')
  expect(typeof payload.undoToken, 'undoToken present').toBe('string')
  return { id: payload.id as string, undoToken: payload.undoToken as string, resourceId: payload.resourceId ?? null }
}

async function undo(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token, data: { undoToken } })
  expect(res.status(), 'undo 200').toBe(200)
  expect(((await res.json()) as { ok?: boolean }).ok).toBe(true)
}

async function redo(request: APIRequestContext, token: string, logId: string): Promise<Operation> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', { token, data: { logId } })
  const body = await readJsonSafe<{ ok?: boolean; error?: unknown; details?: unknown }>(res)
  expect(res.status(), `redo 200: ${JSON.stringify(body)}`).toBe(200)
  expect(body?.ok).toBe(true)
  return readOperation(res)
}

async function listItem(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const separator = path.includes('?') ? '&' : '?'
  const readPath = `${path}${separator}qaRead=${encodeURIComponent(stamp())}`
  const res = await apiRequest(request, 'GET', readPath, { token })
  expect(res.status(), `GET ${readPath} should return 200`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(res)
  return (body?.items ?? []).find((item) => item.id === id)
}

async function expectCreateRedoKeepsId(args: {
  request: APIRequestContext
  token: string
  createPath: string
  readPath: (id: string) => string
  data: Record<string, unknown>
  readCreatedId?: (body: Record<string, unknown>) => string | null
  assertRestored?: (restored: Record<string, unknown>) => void
}): Promise<string> {
  const createRes = await apiRequest(args.request, 'POST', args.createPath, { token: args.token, data: args.data })
  expect(createRes.status(), `POST ${args.createPath} should return 201`).toBe(201)
  const body = await readJsonSafe<Record<string, unknown>>(createRes)
  const id = args.readCreatedId?.(body ?? {}) ?? (typeof body?.id === 'string' ? body.id : null)
  expect(id, `POST ${args.createPath} response should include id`).toBeTruthy()
  const op = readOperation(createRes)
  const readPath = args.readPath(id!)

  await undo(args.request, args.token, op.undoToken)
  expect(await listItem(args.request, args.token, readPath, id!), `${args.createPath} row gone after create-undo`).toBeFalsy()

  const redoOp = await redo(args.request, args.token, op.id)
  expect(redoOp.resourceId, `${args.createPath} redo resourceId equals original id`).toBe(id)

  const restored = await listItem(args.request, args.token, readPath, id!)
  expect(restored, `${args.createPath} row exists again after redo`).toBeTruthy()
  expect(restored!.id, `${args.createPath} redo restored the SAME id`).toBe(id)
  args.assertRestored?.(restored!)
  return id!
}

test.describe('TC-UNDO-005: bespoke create redo restores original ids', () => {
  test('auth.users.create redo keeps id and plaintext fields', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { organizationId } = getTokenContext(await getAuthToken(request, 'admin'))
    const email = `qa-redo-${stamp()}@example.test`
    let userId: string | null = null

    try {
      userId = await expectCreateRedoKeepsId({
        request,
        token,
        createPath: '/api/auth/users',
        readPath: (id) => `/api/auth/users?id=${encodeURIComponent(id)}`,
        data: { email, name: 'QA Redo User', password: 'Secret123!', organizationId },
        assertRestored: (restored) => {
          expect(restored.email, 'redo preserves decrypted email').toBe(email)
          expect(restored.name, 'redo preserves display name').toBe('QA Redo User')
        },
      })
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/auth/users', userId)
    }
  })

  test('customers.companies.create and customers.interactions.create redo keep ids', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(token)
    const displayName = `QA Redo Company ${stamp()}`
    let companyId: string | null = null
    let interactionId: string | null = null

    try {
      companyId = await expectCreateRedoKeepsId({
        request,
        token,
        createPath: '/api/customers/companies',
        readPath: (id) => `/api/customers/companies?id=${encodeURIComponent(id)}`,
        data: { organizationId, tenantId, displayName, primaryEmail: `redo-${stamp()}@example.test` },
        assertRestored: (restored) => {
          expect(restored.displayName ?? restored.display_name, 'redo preserves decrypted company displayName').toBe(displayName)
        },
      })

      const createdCompanyId = companyId
      const title = `QA Redo Interaction ${stamp()}`
      interactionId = await expectCreateRedoKeepsId({
        request,
        token,
        createPath: '/api/customers/interactions',
        readPath: () => `/api/customers/interactions?entityId=${encodeURIComponent(createdCompanyId)}&limit=100`,
        data: { organizationId, tenantId, entityId: createdCompanyId, interactionType: 'note', title, body: 'Redo body', status: 'done' },
        assertRestored: (restored) => {
          expect(restored.title, 'redo preserves interaction title').toBe(title)
        },
      })
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteGeneralEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('directory.organizations.create and feature_toggles.global.create redo keep ids', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(await getAuthToken(request, 'admin'))
    const orgName = `QA Redo Org ${stamp()}`
    const identifier = `qa.redo-${stamp()}`
    let orgId: string | null = null
    let toggleId: string | null = null

    try {
      orgId = await expectCreateRedoKeepsId({
        request,
        token,
        createPath: '/api/directory/organizations',
        readPath: (id) => `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(id)}`,
        data: { tenantId, name: orgName },
        assertRestored: (restored) => {
          expect(restored.name, 'redo preserves organization name').toBe(orgName)
        },
      })

      toggleId = await expectCreateRedoKeepsId({
        request,
        token,
        createPath: '/api/feature_toggles/global',
        readPath: () => `/api/feature_toggles/global?identifier=${encodeURIComponent(identifier)}&pageSize=100`,
        data: { identifier, name: 'QA Redo Toggle', category: 'qa', type: 'boolean', defaultValue: true },
        assertRestored: (restored) => {
          expect(restored.identifier, 'redo preserves toggle identifier').toBe(identifier)
          expect(restored.defaultValue ?? restored.default_value, 'redo preserves toggle default').toBe(true)
        },
      })
    } finally {
      await deleteFeatureToggleIfExists(request, token, toggleId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', orgId)
    }
  })

  test('sales.returns.create redo keeps id and return lines', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'principal lacks sales-write ACLs (run yarn mercato auth sync-role-acls)')

    let orderId: string | null = null
    let returnId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token)
      const createdOrderId = orderId
      const orderLineId = await createOrderLineFixture(request, token, createdOrderId, { quantity: 2, name: 'QA Returnable' })
      const reason = `QA Redo Return ${stamp()}`

      returnId = await expectCreateRedoKeepsId({
        request,
        token,
        createPath: '/api/sales/returns',
        readPath: () => `/api/sales/returns?orderId=${encodeURIComponent(createdOrderId)}&pageSize=100`,
        data: { orderId: createdOrderId, reason, lines: [{ orderLineId, quantity: 1 }] },
        assertRestored: (restored) => {
          expect(restored.reason, 'redo preserves return reason').toBe(reason)
          expect(
            Math.abs(Number(restored.total_gross_amount ?? restored.totalGrossAmount ?? 0)),
            'redo restores return lines used for totals',
          ).toBeGreaterThan(0)
        },
      })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }

    expect(returnId, 'return id was exercised').toBeTruthy()
  })
})
