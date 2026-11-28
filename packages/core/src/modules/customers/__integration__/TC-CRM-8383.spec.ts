import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPipelineFixture, deleteEntityByBody } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteEntityByPathIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const stagesPath = '/api/customers/pipeline-stages'
const dictionaryPath = '/api/customers/dictionaries/pipeline-stages'

async function readStageColor(request: APIRequestContext, token: string, pipelineId: string, stageId: string) {
  const response = await apiRequest(request, 'GET', `${stagesPath}?pipelineId=${pipelineId}`, { token })
  expect(response.ok()).toBe(true)
  const body = await readJsonSafe<{ items: { id: string; color: string | null }[] }>(response)
  return body?.items.find((stage) => stage.id === stageId)?.color
}

async function openPipeline(page: Page, pipelineName: string) {
  await page.goto('/backend/customers/deals/pipeline')
  await page.getByRole('button', { name: /^Pipeline:/ }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('radio', { name: pipelineName, exact: true }) })
  await dialog.getByRole('radio', { name: pipelineName, exact: true }).click()
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
}

test('TC-CRM-8383: stage colors persist and render on the Kanban board', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const suffix = crypto.randomUUID().slice(0, 8)
  const pipelineName = `Color pipeline ${suffix}`
  const stageLabel = `Color stage ${suffix}`
  const pipelineId = await createPipelineFixture(request, token, { name: pipelineName })
  let stageId: string | null = null
  let entryPath: string | null = null

  try {
    const created = await apiRequest(request, 'POST', stagesPath, { token, data: { pipelineId, label: stageLabel, color: 'pink' } })
    expect(created.status()).toBe(201)
    stageId = expectId((await readJsonSafe<{ id: string }>(created))?.id, 'Pipeline stage ID')

    const dictionary = await apiRequest(request, 'GET', `${dictionaryPath}?labels=base`, { token })
    expect(dictionary.ok()).toBe(true)
    const entries = await readJsonSafe<{ items: { id: string; value: string }[] }>(dictionary)
    const entryId = expectId(entries?.items.find((entry) => entry.value === stageLabel)?.id, 'Pipeline-stage dictionary entry ID')
    entryPath = `${dictionaryPath}/${entryId}`

    expect(await readStageColor(request, token, pipelineId, stageId)).toBe('pink')
    await login(page, 'admin')
    await openPipeline(page, pipelineName)
    await expect(page.getByText(stageLabel, { exact: true })).toBeVisible()
    const accent = page.locator('div[aria-hidden="true"][class~="h-1.5"][class~="rounded-sm"]')
    await expect(accent).toHaveClass(/bg-status-pink-icon/)

    const toneEdit = await apiRequest(request, 'PUT', stagesPath, { token, data: { id: stageId, color: 'brand' } })
    expect(toneEdit.ok()).toBe(true)
    expect(await readStageColor(request, token, pipelineId, stageId)).toBe('brand')

    const edited = await apiRequest(request, 'PUT', stagesPath, { token, data: { id: stageId, color: '#22D3BB' } })
    expect(edited.ok()).toBe(true)
    expect(await readStageColor(request, token, pipelineId, stageId)).toBe('#22d3bb')
    await openPipeline(page, pipelineName)
    await expect(accent).toHaveCSS('background-color', 'rgb(34, 211, 187)')

    const patched = await apiRequest(request, 'PATCH', entryPath, { token, data: { color: 'warning' } })
    expect(patched.ok()).toBe(true)
    expect(await readStageColor(request, token, pipelineId, stageId)).toBe('warning')
    await openPipeline(page, pipelineName)
    await expect(accent).toHaveClass(/bg-status-warning-icon/)

    const cleared = await apiRequest(request, 'PUT', stagesPath, { token, data: { id: stageId, color: null } })
    expect(cleared.ok()).toBe(true)
    expect(await readStageColor(request, token, pipelineId, stageId)).toBeNull()
    await openPipeline(page, pipelineName)
    await expect(accent).toHaveClass(/bg-status-success-icon/)
  } finally {
    await deleteEntityByBody(request, token, stagesPath, stageId)
    await deleteEntityByPathIfExists(request, token, entryPath)
    await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
  }
})
