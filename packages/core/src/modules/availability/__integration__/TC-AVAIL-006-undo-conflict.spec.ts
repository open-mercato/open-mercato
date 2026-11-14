import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoByToken, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'

/**
 * TC-AVAIL-006 — undo of a policy write refuses once another actor changed the policy.
 *
 * Undo restores the snapshot logged before the action; when the policy no longer matches the
 * state the action left it in, the undo answers 409 `availability.policies.errors.undoConflict`
 * and the newer change is kept. Undoing your own updates newest first still works.
 */

const POLICIES_API_BASE = '/api/availability/policies'
const UNDO_CONFLICT_CODE = 'availability.policies.errors.undoConflict'
const UNDO_CONFLICT_MESSAGE = 'This policy changed since the action you are undoing. Undo was refused.'

type PolicyRow = { id?: string; isActive?: boolean; minOrderQuantity?: number | null; lowStockThreshold?: number | null }

async function createPolicy(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'POST', POLICIES_API_BASE, {
    token,
    data: { ...getTokenContext(token), productId: randomUUID(), isActive: true },
  })
  expect(response.status(), 'policy fixture create').toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'policy id')
}

async function readPolicy(request: APIRequestContext, token: string, policyId: string): Promise<PolicyRow | null> {
  const response = await apiRequest(request, 'GET', `${POLICIES_API_BASE}?id=${policyId}`, { token })
  expect(response.ok(), 'policy read').toBeTruthy()
  const body = await readJsonSafe<{ items?: PolicyRow[] }>(response)
  return body?.items?.find((item) => item.id === policyId) ?? null
}

async function updatePolicy(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<ReturnType<typeof expectOperation>> {
  const response = await apiRequest(request, 'PUT', POLICIES_API_BASE, { token, data })
  expect(response.status(), `policy update ${JSON.stringify(data)}`).toBe(200)
  return expectOperation(response, `policy update ${JSON.stringify(data)}`)
}

test.describe('TC-AVAIL-006: availability policy undo refuses a stale snapshot', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('undo of an older update keeps a deactivation by another actor and answers 409', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const otherToken = await getAuthToken(request, 'superadmin')
    let policyId: string | null = null
    try {
      policyId = await createPolicy(request, adminToken)
      const adminUpdate = await updatePolicy(request, adminToken, { id: policyId, minOrderQuantity: 5 })
      await updatePolicy(request, otherToken, { id: policyId, isActive: false })

      const undo = await undoByToken(request, adminToken, adminUpdate.undoToken)
      const body = await readJsonSafe<{ error?: string; code?: string }>(undo)
      expect(undo.status(), `stale undo body ${JSON.stringify(body)}`).toBe(409)
      expect(body?.code).toBe(UNDO_CONFLICT_CODE)

      await expect.poll(() => readPolicy(request, adminToken, policyId as string), { timeout: 15_000 }).toEqual(
        expect.objectContaining({ isActive: false, minOrderQuantity: 5 }),
      )
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, POLICIES_API_BASE, policyId)
    }
  })

  test('undoing two of your own updates newest first restores the original policy', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    let policyId: string | null = null
    try {
      policyId = await createPolicy(request, adminToken)
      const first = await updatePolicy(request, adminToken, { id: policyId, minOrderQuantity: 5 })
      const second = await updatePolicy(request, adminToken, { id: policyId, minOrderQuantity: 10 })

      await undoOk(request, adminToken, second.undoToken, 'newest policy update')
      await undoOk(request, adminToken, first.undoToken, 'earlier policy update')

      await expect.poll(() => readPolicy(request, adminToken, policyId as string), { timeout: 15_000 }).toEqual(
        expect.objectContaining({ isActive: true, minOrderQuantity: null }),
      )
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, POLICIES_API_BASE, policyId)
    }
  })

  test('the undo banner shows the conflict when another actor changed the policy since the save', async ({ page, request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const otherToken = await getAuthToken(request, 'superadmin')
    let policyId: string | null = null
    try {
      policyId = await createPolicy(request, adminToken)

      await login(page, 'admin')
      await page.goto(`/backend/availability/policies/${policyId}`)
      const threshold = page.locator('[data-crud-field-id="lowStockThreshold"] input').first()
      await expect(threshold).toBeVisible({ timeout: 30_000 })
      await fillControlledInput(threshold, '7')
      const saved = page.waitForResponse(
        (response) => response.url().includes(POLICIES_API_BASE) && response.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: /save changes/i }).first().click()
      expect((await saved).status()).toBe(200)
      await updatePolicy(request, otherToken, { id: policyId, isActive: false })

      const undoButton = page.getByRole('button', { name: 'Undo', exact: true })
      await expect(undoButton).toBeVisible({ timeout: 5_000 })
      await undoButton.click()

      await expect(page.getByText(UNDO_CONFLICT_MESSAGE).first()).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => readPolicy(request, adminToken, policyId as string), { timeout: 15_000 }).toEqual(
        expect.objectContaining({ isActive: false, lowStockThreshold: 7 }),
      )
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, POLICIES_API_BASE, policyId)
    }
  })
})
