import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

/**
 * TC-CRM-STAGE-PROB-002: pipeline stage default probabilities — UI paths
 * (spec: .ai/specs/2026-10-22-pipeline-stage-default-probabilities.md).
 *
 * The deal edit form, the create-deal page and the Kanban quick-add dialog all send an
 * explicit `probability`, so the server rule never fires for them. Each copies the picked
 * stage's default into its Probability field instead; this covers that client prefill,
 * the persisted manual override, the null-default and opted-out no-ops, and a 0% default.
 *
 * Self-contained: pipelines, stages and deals are created through the API and removed
 * in `finally`.
 */
const PIPELINES = '/api/customers/pipelines'
const STAGES = '/api/customers/pipeline-stages'
const DEALS = '/api/customers/deals'

type Fixtures = {
  enabledPipelineId: string | null
  disabledPipelineId: string | null
  stageIds: string[]
  dealIds: string[]
}

async function expectOk(response: Awaited<ReturnType<typeof apiRequest>>, label: string) {
  expect(response.ok(), `${label} failed: ${response.status()} ${JSON.stringify(await readJsonSafe(response))}`).toBeTruthy()
}

async function configurePipeline(
  request: APIRequestContext,
  token: string,
  fixtures: Fixtures,
  input: { name: string; enabled: boolean; stages: Array<{ label: string; defaultProbability: number | null }> },
): Promise<{ pipelineId: string; stageIds: string[] }> {
  const pipelineId = await createPipelineFixture(request, token, { name: input.name })
  const stageIds: string[] = []
  for (const [order, stage] of input.stages.entries()) {
    const stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stage.label, order })
    fixtures.stageIds.push(stageId)
    stageIds.push(stageId)
    await expectOk(
      await apiRequest(request, 'PUT', STAGES, { token, data: { id: stageId, defaultProbability: stage.defaultProbability } }),
      `PUT stage ${stage.label}`,
    )
  }
  await expectOk(
    await apiRequest(request, 'PUT', PIPELINES, { token, data: { id: pipelineId, stageProbabilitiesEnabled: input.enabled } }),
    `PUT pipeline ${input.name}`,
  )
  return { pipelineId, stageIds }
}

async function readDeal(request: APIRequestContext, token: string, id: string): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `${DEALS}/${id}`, { token })
  await expectOk(response, `GET deal ${id}`)
  const body = (await readJsonSafe(response)) as Record<string, unknown> | null
  return (body?.deal ?? body) as Record<string, unknown>
}

async function findDealIdInStage(request: APIRequestContext, token: string, stageId: string, title: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `${DEALS}?pipelineStageId=${encodeURIComponent(stageId)}&pageSize=10`, { token })
  const body = (await readJsonSafe(response)) as { items?: Array<Record<string, unknown>> } | null
  const match = body?.items?.find((item) => item.title === title)
  return typeof match?.id === 'string' ? match.id : null
}

async function activate(page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.focus()
  await page.keyboard.press('Enter')
}

async function pickOption(page: Page, field: Locator, option: string) {
  await field.getByRole('combobox').first().click({ timeout: 30_000 })
  const item = page.getByRole('option', { name: option })
  await expect(item).toBeVisible({ timeout: 30_000 })
  await item.focus()
  await page.keyboard.press('Enter')
  await expect(item).toBeHidden()
}

async function openDealForm(page: Page, dealId: string): Promise<{ stageField: Locator; probability: Locator }> {
  await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
  const probability = page.locator('[data-crud-field-id="probability"] input:visible').first()
  const expandPanel = page.getByRole('button', { name: /expand form panel/i })
  await expect(probability.or(expandPanel).first()).toBeVisible({ timeout: 60_000 })
  if (!(await probability.isVisible().catch(() => false))) await expandPanel.click()
  await expect(probability).toBeVisible({ timeout: 15_000 })
  const stageField = page.locator('[data-crud-field-id="pipelineStageId"]:visible').first()
  return { stageField, probability }
}

async function openKanbanPipeline(page: Page, pipelineName: string) {
  await page.goto('/backend/customers/deals/pipeline', { waitUntil: 'domcontentloaded' })
  const pipelineChip = page.getByRole('button', { name: /^Pipeline:/ })
  await expect(pipelineChip).toBeVisible({ timeout: 30_000 })
  const popover = page.getByRole('dialog').last()
  const pipelineOption = popover.getByRole('radio', { name: pipelineName, exact: true })
  await expect(async () => {
    if (!(await pipelineOption.isVisible())) await pipelineChip.click()
    await expect(pipelineOption).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await activate(page, pipelineOption)
  await activate(page, popover.getByRole('button', { name: 'Apply', exact: true }))
  await expect(pipelineChip).toContainText(pipelineName, { timeout: 30_000 })
}

async function openQuickAdd(page: Page, stageLabel: string): Promise<{ dialog: Locator; probability: Locator }> {
  const trigger = page.getByRole('button', { name: `Quickly add a deal to ${stageLabel}`, exact: true })
  await expect(trigger).toBeVisible({ timeout: 30_000 })
  await activate(page, trigger)
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Add deal', exact: true }) })
  await expect(dialog).toBeVisible()
  await activate(page, dialog.getByRole('button', { name: /More details/ }))
  const probability = dialog.locator('[data-crud-field-id="probability"] input')
  await expect(probability).toBeVisible()
  return { dialog, probability }
}

test.describe('TC-CRM-STAGE-PROB-002: stage default probabilities in the deal UI', () => {
  test.setTimeout(240_000)

  test('deal forms and the Kanban quick-add prefill the stage default', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const enabledName = `QA STAGE-PROB-002 On ${stamp}`
    const disabledName = `QA STAGE-PROB-002 Off ${stamp}`
    const label = (name: string) => `${name} ${stamp}`
    const fixtures: Fixtures = { enabledPipelineId: null, disabledPipelineId: null, stageIds: [], dealIds: [] }

    try {
      const enabled = await configurePipeline(request, token, fixtures, {
        name: enabledName,
        enabled: true,
        stages: [
          { label: label('Qualify'), defaultProbability: 20 },
          { label: label('Negotiate'), defaultProbability: 60 },
          { label: label('Review'), defaultProbability: null },
          { label: label('Parked'), defaultProbability: 0 },
        ],
      })
      fixtures.enabledPipelineId = enabled.pipelineId
      const disabled = await configurePipeline(request, token, fixtures, {
        name: disabledName,
        enabled: false,
        stages: [
          { label: label('Open'), defaultProbability: 30 },
          { label: label('Closing'), defaultProbability: 90 },
        ],
      })
      fixtures.disabledPipelineId = disabled.pipelineId

      const enabledDealId = await createDealFixture(request, token, {
        title: `QA STAGE-PROB-002 Deal On ${stamp}`,
        pipelineId: enabled.pipelineId,
        pipelineStageId: enabled.stageIds[0],
      })
      fixtures.dealIds.push(enabledDealId)
      await expectOk(
        await apiRequest(request, 'PUT', DEALS, { token, data: { id: enabledDealId, probability: 5 } }),
        'PUT deal probability',
      )
      const disabledDealId = await createDealFixture(request, token, {
        title: `QA STAGE-PROB-002 Deal Off ${stamp}`,
        pipelineId: disabled.pipelineId,
        pipelineStageId: disabled.stageIds[0],
      })
      fixtures.dealIds.push(disabledDealId)
      await expectOk(
        await apiRequest(request, 'PUT', DEALS, { token, data: { id: disabledDealId, probability: 15 } }),
        'PUT deal probability',
      )

      await login(page, 'admin')

      await test.step('deal edit form prefills the stage default and keeps a manual override', async () => {
        const { stageField, probability } = await openDealForm(page, enabledDealId)
        await expect(probability).toHaveValue('5')

        await pickOption(page, stageField, label('Review'))
        await expect(probability).toHaveValue('5')

        await pickOption(page, stageField, label('Negotiate'))
        await expect(probability).toHaveValue('60')

        await probability.fill('42')
        await activate(page, page.getByRole('button', { name: 'Save', exact: true }))
        await expect
          .poll(async () => {
            const deal = await readDeal(request, token, enabledDealId)
            return { stage: deal.pipelineStageId, probability: deal.probability }
          }, { timeout: 30_000 })
          .toEqual({ stage: enabled.stageIds[1], probability: 42 })
      })

      await test.step('deal edit form leaves probability alone when the pipeline is opted out', async () => {
        const { stageField, probability } = await openDealForm(page, disabledDealId)
        await expect(probability).toHaveValue('15')
        await pickOption(page, stageField, label('Closing'))
        await expect(probability).toHaveValue('15')
      })

      await test.step('create-deal page prefills the picked stage default', async () => {
        await page.goto('/backend/customers/deals/create', { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('button', { name: 'Create deal', exact: true }).first()).toBeEnabled({ timeout: 60_000 })
        await pickOption(page, page.locator('[data-crud-field-id="pipelineId"]'), enabledName)
        await pickOption(page, page.locator('[data-crud-field-id="pipelineStageId"]'), label('Negotiate'))
        await expect(page.locator('[data-crud-field-id="probability"] input')).toHaveValue('60')
      })

      await test.step('Kanban quick-add seeds a 0% lane default and stores it', async () => {
        await openKanbanPipeline(page, enabledName)
        const { dialog, probability } = await openQuickAdd(page, label('Parked'))
        await expect(probability).toHaveValue('0')
        const title = `QA STAGE-PROB-002 Quick ${stamp}`
        await dialog.locator('[data-crud-field-id="title"] input').fill(title)
        await activate(page, dialog.getByRole('button', { name: 'Add deal', exact: true }))
        await expect(dialog).toBeHidden({ timeout: 30_000 })
        const parkedStageId = enabled.stageIds[3]
        await expect.poll(() => findDealIdInStage(request, token, parkedStageId, title), { timeout: 30_000 }).not.toBeNull()
        const quickDealId = (await findDealIdInStage(request, token, parkedStageId, title)) as string
        fixtures.dealIds.push(quickDealId)
        const deal = await readDeal(request, token, quickDealId)
        expect(deal.pipelineStageId).toBe(parkedStageId)
        expect(deal.probability).toBe(0)
      })

      await test.step('Kanban quick-add keeps the historic 25% when the lane has no default', async () => {
        const { dialog, probability } = await openQuickAdd(page, label('Review'))
        await expect(probability).toHaveValue('25')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
      })
    } finally {
      for (const dealId of fixtures.dealIds) await deleteEntityIfExists(request, token, DEALS, dealId)
      for (const stageId of fixtures.stageIds) await deleteEntityByBody(request, token, STAGES, stageId)
      await deleteEntityByBody(request, token, PIPELINES, fixtures.enabledPipelineId)
      await deleteEntityByBody(request, token, PIPELINES, fixtures.disabledPipelineId)
    }
  })
})
