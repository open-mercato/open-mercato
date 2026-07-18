import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  readJsonSafe,
  ensureProductionEnabledToggle,
  createBom,
  deleteBomIfExists,
  uniqueUuid,
} from './helpers/production'

/**
 * TC-PROD-002: BOM lifecycle — create, copy version, activate, and the
 * circular bill-of-materials rejection path (task 1.3, spec § Activation).
 *
 * Self-contained: every BOM fixture is created via the API and deleted in
 * `finally`; the toggle is ensured idempotently (see helpers/production.ts).
 */
test.describe('TC-PROD-002: BOM create -> copy version -> activate -> cycle rejection', () => {
  test('copies a version and activates it, archiving the prior active version', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    await ensureProductionEnabledToggle(request, superadminToken)

    let bomId: string | null = null
    let copyId: string | null = null

    try {
      const { id, productId } = await createBom(request, adminToken, { status: 'draft' })
      bomId = id

      const activateResponse = await apiRequest(request, 'POST', `/api/production/boms/${bomId}/activate`, { token: adminToken })
      expect(activateResponse.status()).toBe(200)

      const copyResponse = await apiRequest(request, 'POST', `/api/production/boms/${bomId}/copy-version`, { token: adminToken })
      expect(copyResponse.status()).toBe(201)
      const copyBody = await readJsonSafe<{ id?: string }>(copyResponse)
      expect(typeof copyBody?.id).toBe('string')
      copyId = String(copyBody!.id)

      const listResponse = await apiRequest(request, 'GET', `/api/production/boms?productId=${productId}`, { token: adminToken })
      const listBody = await readJsonSafe<{ items?: Array<{ id?: string; version?: number; status?: string }> }>(listResponse)
      const items = listBody?.items ?? []
      const original = items.find((item) => item.id === bomId)
      const copy = items.find((item) => item.id === copyId)
      expect(original?.status).toBe('active')
      expect(copy?.status).toBe('draft')
      expect(copy?.version).toBe((original?.version ?? 0) + 1)

      const activateCopyResponse = await apiRequest(request, 'POST', `/api/production/boms/${copyId}/activate`, { token: adminToken })
      expect(activateCopyResponse.status()).toBe(200)

      const afterActivateResponse = await apiRequest(request, 'GET', `/api/production/boms?productId=${productId}`, { token: adminToken })
      const afterActivateBody = await readJsonSafe<{ items?: Array<{ id?: string; status?: string }> }>(afterActivateResponse)
      const afterItems = afterActivateBody?.items ?? []
      expect(afterItems.find((item) => item.id === copyId)?.status).toBe('active')
      expect(afterItems.find((item) => item.id === bomId)?.status).toBe('archived')
    } finally {
      await deleteBomIfExists(request, adminToken, copyId)
      await deleteBomIfExists(request, adminToken, bomId)
    }
  })

  test('rejects activation that would create a circular bill of materials (422)', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    await ensureProductionEnabledToggle(request, superadminToken)

    let parentBomId: string | null = null
    let childBomId: string | null = null

    try {
      // Parent product A uses component B; child BOM for product B uses
      // component A -> activating the child (B -> A) while A -> B is active
      // closes the cycle A -> B -> A.
      const productA = uniqueUuid()
      const productB = uniqueUuid()

      const parent = await createBom(request, adminToken, {
        productId: productA,
        status: 'active',
        items: [
          { componentProductId: productB, qtyPerUnit: 1, uom: 'PCS', scrapFactor: 0, isPhantom: false },
        ],
      })
      parentBomId = parent.id

      const child = await createBom(request, adminToken, {
        productId: productB,
        status: 'draft',
        items: [
          { componentProductId: productA, qtyPerUnit: 1, uom: 'PCS', scrapFactor: 0, isPhantom: false },
        ],
      })
      childBomId = child.id

      const activateChildResponse = await apiRequest(request, 'POST', `/api/production/boms/${childBomId}/activate`, { token: adminToken })
      expect(activateChildResponse.status()).toBe(422)
      const body = await readJsonSafe<{ error?: string; cycle?: string[] }>(activateChildResponse)
      expect(typeof body?.error).toBe('string')
      expect(Array.isArray(body?.cycle)).toBe(true)
    } finally {
      await deleteBomIfExists(request, adminToken, childBomId)
      await deleteBomIfExists(request, adminToken, parentBomId)
    }
  })
})
