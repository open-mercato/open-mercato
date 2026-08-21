import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, undoOk, redoOk, skipIfUndoTestsDisabled } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 — data-driven undo/redo regression across simple-CRUD config entities
 * (no fixture prerequisites). For each: create → update → undo (restore) → redo (re-apply)
 * → delete → undo (re-materialize). Asserts invariants I1/I2/I6 via the real command bus.
 *
 * Entities with prerequisites or known defects live in dedicated specs (people, scheduler-jobs)
 * and in `.ai/runs/2026-06-04-2468-undo-redo-verification/contracts.json` for the next stage.
 */

type Entity = {
  label: string
  createPath: string
  createBody: (stamp: string, scope: { organizationId: string; tenantId: string }) => Record<string, unknown>
  updateBody: (stamp: string) => Record<string, unknown>
  readPath: (id: string) => string
  field: string
  scoped?: boolean
}

const ENTITIES: Entity[] = [
  { label: 'catalog.categories', createPath: '/api/catalog/categories', createBody: (s) => ({ name: `Undo Cat ${s}` }), updateBody: (s) => ({ name: `Undo Cat R ${s}` }), readPath: (id) => `/api/catalog/categories?ids=${id}`, field: 'name' },
  { label: 'catalog.priceKinds', createPath: '/api/catalog/price-kinds', createBody: (s) => ({ code: `pk_${s}`, title: `Undo PK ${s}` }), updateBody: (s) => ({ title: `Undo PK R ${s}` }), readPath: (id) => `/api/catalog/price-kinds?id=${id}`, field: 'title' },
  { label: 'catalog.products', createPath: '/api/catalog/products', createBody: (s) => ({ title: `Undo Prod ${s}` }), updateBody: (s) => ({ title: `Undo Prod R ${s}` }), readPath: (id) => `/api/catalog/products?id=${id}`, field: 'title' },
  { label: 'sales.channels', createPath: '/api/sales/channels', createBody: (s) => ({ name: `Undo Ch ${s}`, code: `uc_${s}` }), updateBody: (s) => ({ name: `Undo Ch R ${s}`, code: `uc_${s}` }), readPath: (id) => `/api/sales/channels?id=${id}`, field: 'name' },
  { label: 'sales.shipping-methods', createPath: '/api/sales/shipping-methods', createBody: (s) => ({ name: `Undo Ship ${s}`, code: `us_${s}` }), updateBody: (s) => ({ name: `Undo Ship R ${s}` }), readPath: (id) => `/api/sales/shipping-methods?id=${id}`, field: 'name' },
  { label: 'sales.payment-methods', createPath: '/api/sales/payment-methods', createBody: (s) => ({ name: `Undo Pay ${s}`, code: `up_${s}` }), updateBody: (s) => ({ name: `Undo Pay R ${s}` }), readPath: (id) => `/api/sales/payment-methods?id=${id}`, field: 'name' },
  { label: 'sales.delivery-windows', createPath: '/api/sales/delivery-windows', createBody: (s) => ({ name: `Undo DW ${s}`, code: `ud_${s}` }), updateBody: (s) => ({ name: `Undo DW R ${s}` }), readPath: (id) => `/api/sales/delivery-windows?id=${id}`, field: 'name' },
  { label: 'sales.tax-rates', createPath: '/api/sales/tax-rates', createBody: (s) => ({ name: `Undo Tax ${s}`, code: `ut_${s}`, rate: '7.5' }), updateBody: (s) => ({ name: `Undo Tax R ${s}` }), readPath: (id) => `/api/sales/tax-rates?id=${id}`, field: 'name' },
  { label: 'staff.teams', createPath: '/api/staff/teams', createBody: (s) => ({ name: `Undo Team ${s}` }), updateBody: (s) => ({ name: `Undo Team R ${s}` }), readPath: (id) => `/api/staff/teams?ids=${id}`, field: 'name' },
  { label: 'staff.team-roles', createPath: '/api/staff/team-roles', createBody: (s) => ({ name: `Undo Role ${s}` }), updateBody: (s) => ({ name: `Undo Role R ${s}` }), readPath: (id) => `/api/staff/team-roles?ids=${id}`, field: 'name' },
  { label: 'resources.resources', createPath: '/api/resources/resources', createBody: (s) => ({ name: `Undo Res ${s}` }), updateBody: (s) => ({ name: `Undo Res R ${s}` }), readPath: (id) => `/api/resources/resources?ids=${id}`, field: 'name' },
  { label: 'resources.resource-types', createPath: '/api/resources/resource-types', createBody: (s) => ({ name: `Undo RT ${s}` }), updateBody: (s) => ({ name: `Undo RT R ${s}` }), readPath: (id) => `/api/resources/resource-types?ids=${id}`, field: 'name' },
  { label: 'auth.roles', createPath: '/api/auth/roles', createBody: (s) => ({ name: `Undo AuthRole ${s}` }), updateBody: (s) => ({ name: `Undo AuthRole R ${s}` }), readPath: (id) => `/api/auth/roles?id=${id}`, field: 'name' },
  { label: 'currencies.currencies', scoped: true, createPath: '/api/currencies/currencies', createBody: (s, sc) => ({ code: s.slice(-3).toUpperCase().replace(/[^A-Z]/g, 'X'), name: `Undo Cur ${s}`, ...sc }), updateBody: (s) => ({ name: `Undo Cur R ${s}` }), readPath: (id) => `/api/currencies/currencies?id=${id}`, field: 'name' },
]

function findField(body: any, id: string, field: string): unknown {
  const visit = (node: any): any => {
    if (!node || typeof node !== 'object') return null
    if (!Array.isArray(node) && node.id === id && field in node) return node
    for (const v of Array.isArray(node) ? node : Object.values(node)) { const r = visit(v); if (r) return r }
    return null
  }
  const obj = visit(body)
  if (obj) return obj[field]
  if (Array.isArray(body?.items) && body.items[0]) return body.items[0][field]
  return undefined
}

test.describe('TC-UNDO-001 config-entities undo/redo', () => {
  test.setTimeout(120_000)

  let token: string
  let scope: { organizationId: string; tenantId: string }

  test.beforeAll(async ({ request }) => {
    skipIfUndoTestsDisabled()
    token = await getAuthToken(request, 'admin')
    const orgs = (await readJsonSafe(await apiRequest(request, 'GET', '/api/directory/organizations?pageSize=5', { token }))) as any
    const org = (orgs?.items || []).find((o: any) => o.id && o.tenantId) || (orgs?.items || [])[0]
    scope = { organizationId: org?.id, tenantId: org?.tenantId }
  })

  for (const e of ENTITIES) {
    test(`${e.label}: create→update→undo→redo→delete→undo`, async ({ request }) => {
      const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
      let id: string | null = null
      const read = async (rid: string) => findField((await readJsonSafe(await apiRequest(request, 'GET', e.readPath(rid), { token }))) as any, rid, e.field)
      try {
        const createRes = await apiRequest(request, 'POST', e.createPath, { token, data: e.createBody(stamp, scope) })
        expect(createRes.ok(), `${e.label} create ${createRes.status()}`).toBeTruthy()
        const createOp = expectOperation(createRes, `${e.label}.create`)
        id = createOp.resourceId
        expect(id, `${e.label} resourceId`).toBeTruthy()
        const v0 = await read(id as string)
        expect(v0, `${e.label} field present after create`).toBeDefined()

        const updateRes = await apiRequest(request, 'PUT', e.createPath, { token, data: { id, ...e.updateBody(stamp), ...(e.scoped ? scope : {}) } })
        expect(updateRes.ok(), `${e.label} update ${updateRes.status()}`).toBeTruthy()
        const updateOp = expectOperation(updateRes, `${e.label}.update`)
        const v1 = await read(id as string)
        expect(JSON.stringify(v1), `${e.label} changed by update`).not.toBe(JSON.stringify(v0))

        await undoOk(request, token, updateOp.undoToken, `${e.label} undo update`)
        expect(JSON.stringify(await read(id as string)), `${e.label} update→undo restores (I1)`).toBe(JSON.stringify(v0))

        await redoOk(request, token, updateOp.logId, `${e.label} redo update`)
        expect(JSON.stringify(await read(id as string)), `${e.label} update→redo re-applies (I6)`).toBe(JSON.stringify(v1))

        const deleteRes = await apiRequest(request, 'DELETE', `${e.createPath}?id=${id}`, { token })
        expect(deleteRes.ok(), `${e.label} delete ${deleteRes.status()}`).toBeTruthy()
        const deleteOp = expectOperation(deleteRes, `${e.label}.delete`)
        await undoOk(request, token, deleteOp.undoToken, `${e.label} undo delete`)
        expect(await read(id as string), `${e.label} delete→undo re-materializes (I2)`).toBeDefined()
      } finally {
        if (id) await apiRequest(request, 'DELETE', `${e.createPath}?id=${id}`, { token }).catch(() => {})
      }
    })
  }
})
