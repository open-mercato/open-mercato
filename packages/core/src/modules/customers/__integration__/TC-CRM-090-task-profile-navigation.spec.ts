import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = {
  dependsOnModules: ['customers', 'feature_toggles'],
}

const INTERACTIONS = '/api/customers/interactions'
const UNIFIED_FLAG = 'customers.interactions.unified'

type ToggleOverride = { id: string; value: boolean; updatedAt: string | null }

async function readOverride(request: APIRequestContext, token: string, toggleId: string): Promise<ToggleOverride> {
  const response = await apiRequest(request, 'GET', `/api/feature_toggles/global/${toggleId}/override`, { token })
  expect(response.ok(), 'The interaction-mode override should be readable').toBeTruthy()
  const body = await readJsonSafe<ToggleOverride>(response)
  expect(body, 'The interaction-mode override response should be present').toBeTruthy()
  return body as ToggleOverride
}

async function writeOverride(
  request: APIRequestContext,
  token: string,
  toggleId: string,
  isOverride: boolean,
  value: boolean,
): Promise<void> {
  const current = await readOverride(request, token, toggleId)
  const response = await apiRequest(request, 'PUT', '/api/feature_toggles/overrides', {
    token,
    headers: current.updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt } : {},
    data: { toggleId, isOverride, ...(isOverride ? { overrideValue: value } : {}) },
  })
  expect(response.ok(), 'The interaction-mode override should update').toBeTruthy()
}

async function useInteractionMode(
  request: APIRequestContext,
  token: string,
  unified: boolean,
): Promise<() => Promise<void>> {
  const response = await apiRequest(request, 'GET', `/api/feature_toggles/global?identifier=${UNIFIED_FLAG}&pageSize=100`, { token })
  expect(response.ok(), 'Interaction-mode feature toggles should be readable').toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<{ id: string; identifier: string }> }>(response)
  const existing = body?.items?.find((item) => item.identifier === UNIFIED_FLAG)
  const toggleId = existing?.id ?? await createFeatureToggleFixture(request, token, {
    identifier: UNIFIED_FLAG,
    name: 'Unified Interactions',
    type: 'boolean',
    defaultValue: false,
  })
  const original = await readOverride(request, token, toggleId)
  const restore = async () => {
    if (!existing) {
      await deleteFeatureToggleIfExists(request, token, toggleId)
      return
    }
    await writeOverride(request, token, toggleId, Boolean(original.id), original.value)
  }
  try {
    await writeOverride(request, token, toggleId, true, unified)
  } catch (error) {
    await restore()
    throw error
  }
  return restore
}

async function createTask(
  request: APIRequestContext,
  token: string,
  entityId: string,
  title: string,
  source: string | null,
  status = 'planned',
): Promise<string> {
  const response = await apiRequest(request, 'POST', INTERACTIONS, {
    token,
    data: { entityId, interactionType: 'task', title, source, status },
  })
  expect(response.status(), 'The native task should be created').toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'The native task should have an id')
}

test.describe('TC-CRM-090: Customer task navigation to the person Tasks tab', () => {
  for (const unified of [false, true]) {
    const mode = unified ? 'unified' : 'compatibility'

    test(`keeps native tasks visible after navigation and reload in ${mode} mode`, async ({ page }, testInfo) => {
      await login(page, 'superadmin')
      const request = page.request
      const token = await getAuthToken(request, 'superadmin')
      const stamp = `${Date.now()}-${testInfo.retry}`
      const personName = `Task navigation ${stamp}`
      const taskTitles = [`Native null ${stamp}`, `Native other ${stamp}`, `Unrelated task ${stamp}`]
      const personIds: string[] = []
      const taskIds: string[] = []
      let restoreMode: (() => Promise<void>) | null = null

      try {
        restoreMode = await useInteractionMode(request, token, unified)
        personIds.push(await createPersonFixture(request, token, {
          firstName: 'Task', lastName: `navigation ${stamp}`, displayName: personName,
        }))
        personIds.push(await createPersonFixture(request, token, {
          firstName: 'Unrelated', lastName: `person ${stamp}`, displayName: `Unrelated person ${stamp}`,
        }))
        taskIds.push(await createTask(request, token, personIds[0], taskTitles[0], null))
        taskIds.push(await createTask(request, token, personIds[0], taskTitles[1], 'qa:profile-navigation', 'done'))
        taskIds.push(await createTask(request, token, personIds[1], taskTitles[2], null))

        const overviewResponse = await apiRequest(request, 'GET', `/api/customers/people/${personIds[0]}`, { token })
        expect(overviewResponse.ok()).toBeTruthy()
        const overview = await readJsonSafe<{ interactionMode?: string }>(overviewResponse)
        expect(overview?.interactionMode).toBe(unified ? 'canonical' : 'legacy')

        await page.goto('/backend/customer-tasks')
        await expect(page.getByRole('heading', { name: 'Customer related tasks', exact: true })).toBeVisible()
        await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(stamp)
        const taskRow = page.getByRole('row').filter({ hasText: taskTitles[0] })
        await expect(taskRow).toBeVisible()
        await expect(page.getByRole('row').filter({ hasText: taskTitles[1] })).toBeVisible()
        await expect(page.getByRole('row').filter({ hasText: taskTitles[2] })).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`${mode}-global-tasks.png`), fullPage: true })
        await taskRow.getByRole('link', { name: personName, exact: true }).click()

        await expect(page).toHaveURL(new RegExp(`/backend/customers/people-v2/${personIds[0]}\\?tab=tasks$`))
        await expect(page.getByRole('heading', { name: personName, exact: true })).toBeVisible()
        await expect(page.getByRole('tab', { name: /^Tasks(?:\s+\d+)?$/ })).toHaveAttribute('aria-selected', 'true')
        const nativeTask = page.getByRole('article').filter({ hasText: taskTitles[0] })
        const completedTask = page.getByRole('article').filter({ hasText: taskTitles[1] })
        await expect(nativeTask).toBeVisible()
        await expect(completedTask).toBeVisible()
        await expect(nativeTask.getByRole('checkbox')).not.toBeChecked()
        await expect(completedTask.getByRole('checkbox')).toBeChecked()
        await expect(page.getByText(taskTitles[2], { exact: true })).toHaveCount(0)

        await page.reload()
        await expect(page.getByRole('tab', { name: /^Tasks(?:\s+\d+)?$/ })).toHaveAttribute('aria-selected', 'true')
        await expect(nativeTask).toBeVisible()
        await expect(completedTask.getByRole('checkbox')).toBeChecked()
        await expect(page.getByText(taskTitles[2], { exact: true })).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath(`${mode}-person-tasks.png`), fullPage: true })
      } finally {
        for (const taskId of taskIds) await deleteEntityIfExists(request, token, INTERACTIONS, taskId)
        for (const personId of personIds) await deleteEntityIfExists(request, token, '/api/customers/people', personId)
        await restoreMode?.()
      }
    })
  }
})
