import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'audit_logs', 'directory'] }

const dealsPath = '/api/customers/deals'
const reopenPath = `${dealsPath}/reopen`

async function readDeal(request: APIRequestContext, token: string, id: string) {
  const response = await apiRequest(request, 'GET', `${dealsPath}/${id}?include=stages`, { token })
  expect(response.status(), 'Deal detail').toBe(200)
  const result = await readJsonSafe<{ deal: { updatedAt: string; status: string; pipelineStageId: string | null } }>(response)
  expect(result?.deal).toBeDefined()
  if (!result?.deal) throw new Error('Missing deal detail')
  return result.deal
}

async function reopen(request: APIRequestContext, token: string, id: string, pipelineStageId: string | null, updatedAt?: string) {
  return apiRequest(request, 'POST', reopenPath, {
    token,
    data: { id, pipelineStageId },
    headers: updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : undefined,
    retryTransport: false,
  })
}

test('the Lost confirmation explains whether a deal can be reopened', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const title = `TC-CRM-4330 ${randomUUID()}`
  const dealId = await createDealFixture(request, token, { title })

  try {
    await login(page, 'admin')
    await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close deal', exact: true }).click()
    await page.getByRole('button', { name: 'Lost', exact: true }).click()

    await expect(page.getByRole('dialog').getByText(/users with reopen permission can use Reopen deal/i)).toBeVisible()
  } finally {
    await deleteEntityIfExists(request, token, dealsPath, dealId)
  }
})

test('reopens a won deal by keyboard and retains its selected open stage after reload', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  const title = `Won deal ${randomUUID()}`
  const pipelineId = await createPipelineFixture(request, token, { name: title })
  const stageIds: string[] = []
  let dealId: string | null = null

  try {
    const wonStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Won', order: 0 })
    stageIds.push(wonStageId)
    dealId = await createDealFixture(request, token, { title, status: 'win', pipelineId, pipelineStageId: wonStageId })

    await login(page, 'admin')
    await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
    const action = page.getByRole('button', { name: 'Reopen deal', exact: true })
    await action.click()
    const dialog = page.getByRole('dialog', { name: 'Reopen deal' })
    await expect(dialog.getByText('This pipeline has no open stages.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Reopen deal' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect((await readDeal(request, token, dealId)).status).toBe('win')

    const stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Qualification', order: 1 })
    stageIds.push(stageId)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await action.click()
    await dialog.getByRole('combobox', { name: 'Open stage' }).click()
    await page.getByRole('option', { name: 'Qualification', exact: true }).click()
    await testInfo.attach('reopen-stage-selection', { body: await page.screenshot(), contentType: 'image/png' })
    await page.keyboard.press('Control+Enter')

    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Close deal', exact: true })).toBeVisible()
    expect(await readDeal(request, token, dealId)).toMatchObject({
      status: 'open', pipelineStageId: stageId, closureOutcome: null, lossReasonId: null, lossNotes: null,
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Close deal', exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: /^Pipeline progress/ }).locator('[aria-current="step"]')).toContainText('Qualification')
    await testInfo.attach('deal-reopened', { body: await page.screenshot(), contentType: 'image/png' })
  } finally {
    await deleteEntityIfExists(request, token, dealsPath, dealId)
    for (const stageId of stageIds) await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId)
    await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
  }
})

test('handles stale and concurrent attempts and restores a legacy loss on undo', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const expectedCloseAt = '2035-10-20T12:00:00.000Z'
  const dealId = await createDealFixture(request, token, {
    title: `Legacy lost ${randomUUID()}`, status: 'loose', expectedCloseAt,
  })

  try {
    const before = await readDeal(request, token, dealId)
    const update = await apiRequest(request, 'PUT', dealsPath, {
      token, data: { id: dealId, lossNotes: 'Historical loss notes' },
    })
    expect(update.ok()).toBe(true)
    const closed = await readDeal(request, token, dealId)
    const stale = await reopen(request, token, dealId, null, before.updatedAt)
    expect(stale.status()).toBe(409)
    expect(await readJsonSafe(stale)).toHaveProperty('currentUpdatedAt', closed.updatedAt)

    const outcomes = await Promise.all([
      reopen(request, token, dealId, null, closed.updatedAt),
      reopen(request, token, dealId, null, closed.updatedAt),
    ])
    expect(outcomes.map((response) => response.status()).sort()).toEqual([200, 409])
    const success = outcomes.find((response) => response.ok())
    if (!success) throw new Error('Expected one successful reopen')
    expect(await readDeal(request, token, dealId)).toMatchObject({
      status: 'open', pipelineId: null, pipelineStageId: null, lossNotes: null, closureOutcome: null, expectedCloseAt,
    })
    expect((await reopen(request, token, dealId, null)).status()).toBe(409)

    const operation = expectOperation(success, 'deal reopen')
    await undoOk(request, token, operation.undoToken, 'deal reopen')
    expect(await readDeal(request, token, dealId)).toMatchObject({
      status: closed.status, lossNotes: 'Historical loss notes',
    })
  } finally {
    await deleteEntityIfExists(request, token, dealsPath, dealId)
  }
})

test('uses the inferred legacy pipeline and rejects terminal and unrelated destinations', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const title = `Legacy stage ${randomUUID()}`
  const pipelineIds: string[] = []
  const stageIds: string[] = []
  let dealId: string | null = null

  try {
    const pipelineId = await createPipelineFixture(request, token, { name: title })
    pipelineIds.push(pipelineId)
    const otherPipelineId = await createPipelineFixture(request, token, { name: `${title} other` })
    pipelineIds.push(otherPipelineId)
    const legacyStageId = await createPipelineStageFixture(request, token, { pipelineId, label: title, order: 0 })
    stageIds.push(legacyStageId)
    const lostStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Lost', order: 1 })
    stageIds.push(lostStageId)
    const otherStageId = await createPipelineStageFixture(request, token, { pipelineId: otherPipelineId, label: 'Review', order: 0 })
    stageIds.push(otherStageId)

    const created = await apiRequest(request, 'POST', dealsPath, {
      token, data: { title, status: 'closed', pipelineStage: title },
    })
    expect(created.status()).toBe(201)
    const result = await readJsonSafe<{ id?: string; dealId?: string }>(created)
    dealId = expectId(result?.dealId ?? result?.id, 'Closed legacy deal')
    const before = await readDeal(request, token, dealId)
    expect(before).toMatchObject({ status: 'closed', pipelineId, pipelineStageId: legacyStageId })
    for (const invalidStageId of [null, lostStageId, otherStageId, randomUUID()]) {
      expect((await reopen(request, token, dealId, invalidStageId, before.updatedAt)).status()).toBe(400)
    }
    expect(await readDeal(request, token, dealId)).toMatchObject({ status: 'closed', updatedAt: before.updatedAt })
    expect((await reopen(request, token, dealId, legacyStageId, before.updatedAt)).status()).toBe(200)
    expect(await readDeal(request, token, dealId)).toMatchObject({ status: 'open', pipelineId, pipelineStageId: legacyStageId })
  } finally {
    await deleteEntityIfExists(request, token, dealsPath, dealId)
    for (const stageId of stageIds) await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId)
    for (const pipelineId of pipelineIds) await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
  }
})

test('a deal editor without the reopen grant lacks the dedicated action', async ({ page, request, baseURL }) => {
  const token = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(token)
  const marker = randomUUID()
  const title = `Restricted deal ${marker}`
  const email = `reopen-${marker}@example.test`
  const password = `Qa1!-${randomUUID()}`
  let dealId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null

  try {
    dealId = await createDealFixture(request, token, { title, status: 'lost' })
    roleId = await createRoleFixture(request, token, { name: `reopen-reader-${marker}`, tenantId })
    await setRoleAclFeatures(request, token, {
      roleId, features: ['customers.deals.view', 'customers.deals.manage'], organizations: [organizationId],
    })
    userId = await createUserFixture(request, token, { email, password, organizationId, roles: [roleId] })
    const loginResponse = await page.request.post('/api/auth/login', {
      form: { email, password },
    })
    expect(loginResponse.ok()).toBe(true)
    if (!baseURL) throw new Error('Missing integration base URL')
    await page.context().addCookies([
      { name: 'om_selected_tenant', value: tenantId, url: baseURL },
      { name: 'om_selected_org', value: organizationId, url: baseURL },
    ])
    const credentials = await readJsonSafe<{ token: string }>(loginResponse)
    if (!credentials?.token) throw new Error('Missing deal editor token')

    await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reopen deal', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Close deal', exact: true })).toHaveCount(0)
    expect((await reopen(request, credentials.token, dealId, null)).status()).toBe(403)
    expect((await apiRequest(request, 'PUT', dealsPath, {
      token: credentials.token, data: { id: dealId, status: 'open' },
    })).status()).toBe(200)
  } finally {
    await deleteUserIfExists(request, token, userId)
    await deleteRoleIfExists(request, token, roleId)
    await deleteEntityIfExists(request, token, dealsPath, dealId)
  }
})

test('a reopen grant is limited to deals in the editor’s organization', async ({ request }) => {
  const token = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenContext(token)
  const marker = randomUUID()
  const email = `reopen-scoped-${marker}@example.test`
  const password = `Qa1!-${randomUUID()}`
  let foreignOrganizationId: string | null = null
  let foreignDealId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null

  try {
    foreignOrganizationId = await createOrganizationFixture(request, token, { name: `Reopen scope ${marker}`, tenantId })
    const created = await apiRequestWithSelectedOrg(request, 'POST', dealsPath, {
      token,
      selectedOrgId: foreignOrganizationId,
      data: { title: `Foreign deal ${marker}`, status: 'lost' },
    })
    expect(created.status()).toBe(201)
    const result = await readJsonSafe<{ id?: string; dealId?: string }>(created)
    foreignDealId = expectId(result?.dealId ?? result?.id, 'Foreign deal')

    roleId = await createRoleFixture(request, token, { name: `Reopen scope ${marker}`, tenantId })
    await setRoleAclFeatures(request, token, {
      roleId, features: ['customers.deals.view', 'customers.deals.manage', 'sales.reopen'], organizations: [organizationId],
    })
    userId = await createUserFixture(request, token, { email, password, organizationId, roles: [roleId] })
    const editorToken = await withCredentialIsolatedRequest((isolated) => getAuthToken(isolated, email, password))
    expect((await reopen(request, editorToken, foreignDealId, null)).status()).toBe(404)
  } finally {
    await deleteUserIfExists(request, token, userId)
    await deleteRoleIfExists(request, token, roleId)
    if (foreignOrganizationId && foreignDealId) {
      await apiRequestWithSelectedOrg(request, 'DELETE', `${dealsPath}?id=${foreignDealId}`, {
        token, selectedOrgId: foreignOrganizationId,
      })
    }
    await deleteOrganizationIfExists(request, token, foreignOrganizationId)
  }
})
