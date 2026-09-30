import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { CAMPAIGNS_PATH, createCampaign, deleteCampaignIfExists, getCampaign, saveGraph } from './helpers/marketing'
import type { CampaignDetail } from './helpers/marketing'

type Step = { id: string; type: string; params: Record<string, unknown>; variants?: Array<{ key: string; steps: Step[] }> }

/**
 * Opens the editor and waits for the CLIENT to have loaded the campaign.
 *
 * The shell is server-rendered, so anything done before the client's first request is undone by hydration — the
 * campaign fetch is the first thing the hydrated editor does, which makes its answer the signal.
 */
async function openEditor(page: Page, campaignId: string): Promise<void> {
  const loaded = page.waitForResponse((response) =>
    response.url().includes(`${CAMPAIGNS_PATH}/${campaignId}`) && response.request().method() === 'GET')
  await page.goto(`/backend/marketing/campaigns/${campaignId}`, { waitUntil: 'domcontentloaded' })
  await loaded
  await expect(page.locator('#campaign-name')).toBeVisible({ timeout: 20_000 })
}

function node(page: Page, text: string | RegExp) {
  return page.locator('.react-flow__node').filter({ hasText: text }).first()
}

/** Palette labels are unique on the editor; the app's own sidebar is an `aside` too, so no `aside` scoping. */
function paletteButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true })
}

async function saveAndRead(page: Page, request: APIRequestContext, token: string, campaignId: string): Promise<CampaignDetail> {
  const saved = page.waitForResponse((response) =>
    response.url().includes(`${CAMPAIGNS_PATH}/${campaignId}/save-graph`) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await saved).status(), 'save-graph').toBe(200)
  await expect(page.getByText('Unsaved changes')).toBeHidden()
  return getCampaign(request, token, campaignId)
}

async function confirmDialog(page: Page, button: 'Confirm' | 'Cancel'): Promise<void> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: button }).click()
  await expect(dialog).toBeHidden()
}

/**
 * TC-MA-042: authoring a campaign on the canvas, as a person does it.
 *
 * Every assertion about what was built is made against the saved campaign read back through the API, so a canvas
 * that LOOKS right but saves something else fails here. Each test owns its campaign and deletes it; none is left
 * enabled, and the one that publishes has no audience-matching side effect because its only step awards points to
 * a trigger that never fires in this environment's test data.
 */
test.describe('TC-MA-042 campaign authoring on the canvas', () => {
  test.describe.configure({ timeout: 120_000 })

  test('a new campaign is created from the list and opens in the editor', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      await login(page, 'admin')
      const listed = page.waitForResponse((response) =>
        response.url().includes(CAMPAIGNS_PATH) && response.request().method() === 'GET')
      await page.goto('/backend/marketing/campaigns', { waitUntil: 'domcontentloaded' })
      await listed

      const created = page.waitForResponse((response) =>
        response.url().endsWith(CAMPAIGNS_PATH) && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'New campaign' }).click()
      campaignId = ((await (await created).json()) as { id?: string }).id ?? null
      expect(campaignId).toBeTruthy()

      await page.waitForURL(`**/backend/marketing/campaigns/${campaignId}`, { timeout: 20_000 })
      await expect(page.locator('#campaign-name')).toHaveValue('New campaign', { timeout: 20_000 })
      await expect(node(page, 'Audience')).toBeVisible()
      await expect(node(page, 'Everyone the trigger produces')).toBeVisible()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('results and runs are reachable from the list and from the editor', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `TC-MA-042 links ${Date.now()}`
    const campaignId = await createCampaign(request, token, name)
    try {
      await login(page, 'admin')
      const listed = page.waitForResponse((response) =>
        response.url().includes(CAMPAIGNS_PATH) && response.request().method() === 'GET')
      await page.goto('/backend/marketing/campaigns', { waitUntil: 'domcontentloaded' })
      await listed
      const row = page.getByRole('row', { name: new RegExp(name) }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })

      await row.getByRole('button', { name: 'Open actions' }).click()
      await page.getByRole('menuitem', { name: 'Results' }).click()
      await page.waitForURL(`**/backend/marketing/campaigns/${campaignId}/results`, { timeout: 20_000 })

      await page.goBack()
      await expect(row).toBeVisible({ timeout: 20_000 })
      await row.getByRole('button', { name: 'Open actions' }).click()
      await page.getByRole('menuitem', { name: 'Runs' }).click()
      await page.waitForURL(`**/backend/marketing/campaigns/${campaignId}/runs`, { timeout: 20_000 })

      await openEditor(page, campaignId)
      await expect(page.getByRole('link', { name: 'Results', exact: true })).toHaveAttribute('href', `/backend/marketing/campaigns/${campaignId}/results`)
      await page.getByRole('link', { name: 'Runs', exact: true }).click()
      await page.waitForURL(`**/backend/marketing/campaigns/${campaignId}/runs`, { timeout: 20_000 })
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('triggers and steps come from the palette, are edited in the inspector, reordered and removed', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const campaignId = await createCampaign(request, token, `TC-MA-042 steps ${stamp}`)
    try {
      await login(page, 'admin')
      await openEditor(page, campaignId)

      await fillControlledInput(page.locator('#campaign-name'), `TC-MA-042 authored ${stamp}`)
      await paletteButton(page, 'Customer registered').click()
      // By the name, not the event id. The node used to print `customers.person.created` under its title;
      // it now says when the trigger fires, because the id was the engine talking to itself.
      await expect(node(page, 'Customer registered')).toBeVisible()
      await expect(node(page, 'as it happens')).toBeVisible()

      // A campaign that ends on a wait is refused, and the editor says why instead of "could not save".
      await paletteButton(page, 'Wait').click()
      const refused = page.waitForResponse((response) =>
        response.url().includes(`${CAMPAIGNS_PATH}/${campaignId}/save-graph`) && response.request().method() === 'PUT')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      expect((await refused).status()).toBe(400)
      await expect(page.getByText('The last step is a wait, which has nothing to wait for.').first()).toBeVisible()

      await paletteButton(page, 'Add score points').click()
      await fillControlledInput(page.locator('#param-points'), '5')
      await paletteButton(page, 'Add score points').click()
      await fillControlledInput(page.locator('#param-points'), '7')

      let saved = await saveAndRead(page, request, token, campaignId)
      expect(saved.name).toBe(`TC-MA-042 authored ${stamp}`)
      expect(saved.triggers).toEqual([expect.objectContaining({ kind: 'event', eventId: 'customers.person.created' })])
      expect(saved.definition.steps.map((step) => [step.type, step.params.points ?? null])).toEqual([
        ['wait', null], ['add_points', 5], ['add_points', 7],
      ])

      // The step just added is still selected; move it above the other award.
      await page.getByRole('button', { name: 'Move up' }).click()
      saved = await saveAndRead(page, request, token, campaignId)
      expect(saved.definition.steps.map((step) => step.params.points ?? null)).toEqual([null, 7, 5])

      await node(page, 'Wait').click()
      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      saved = await saveAndRead(page, request, token, campaignId)
      expect(saved.definition.steps.map((step) => [step.type, step.params.points])).toEqual([['add_points', 7], ['add_points', 5]])
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  /**
   * The guided editor is the default, and the point of this test is that it writes the SAME expression.
   *
   * Nothing here types a field path or a JSON value: the field is picked from a grouped list, the operator
   * reads as a phrase, and the value is a number box. What lands in the database is the expression the
   * platform's own evaluator has always read.
   */
  test('an audience is built by picking a field and an operator, and saved as the same expression', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `TC-MA-042 guided ${Date.now()}`
    const campaignId = await createCampaign(request, token, marker)
    try {
      await login(page, 'admin')
      await openEditor(page, campaignId)

      await node(page, 'Audience').click()
      await page.getByRole('button', { name: 'Add a condition' }).click()

      // The first rule starts on the first catalogued field; changing it resets the operator and the
      // value, because both belonged to the old field.
      await page.getByRole('combobox').filter({ hasText: 'Saved segment' }).click()
      await page.getByRole('option', { name: 'Number of orders', exact: true }).click()
      await expect(page.getByRole('combobox').filter({ hasText: 'at least' })).toBeVisible()
      await fillControlledInput(page.getByRole('spinbutton').first(), '2')

      const saved = await saveAndRead(page, request, token, campaignId)
      expect(saved.definition.audience).toMatchObject({
        operator: 'AND',
        rules: [expect.objectContaining({ field: 'orders.count', operator: '>=', value: 2 })],
      })

      // And the node says it in words, rather than repeating the path back at the author.
      await expect(node(page, 'Number of orders at least 2')).toBeVisible()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('the advanced editor still takes a raw field path, and the guided one shows what it wrote', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `TC-MA-042 audience ${Date.now()}`
    const campaignId = await createCampaign(request, token, marker)
    try {
      await login(page, 'admin')
      await openEditor(page, campaignId)

      await node(page, 'Audience').click()
      await page.getByRole('button', { name: 'Advanced editor' }).click()
      await page.getByRole('button', { name: 'Add First Condition' }).click()
      await fillControlledInput(page.getByPlaceholder('e.g., status, user.email'), 'customer.displayName')
      await fillControlledInput(page.getByPlaceholder('e.g., "ACTIVE" or ["A","B"]'), marker)

      await page.getByRole('button', { name: 'Estimate audience' }).click()
      await expect(page.getByText(/customers match|At most \d+ customers/).first()).toBeVisible({ timeout: 20_000 })

      const saved = await saveAndRead(page, request, token, campaignId)
      expect(saved.definition.audience).toMatchObject({
        operator: 'AND',
        rules: [expect.objectContaining({ field: 'customer.displayName', operator: '=', value: marker })],
      })
      // `customer.displayName` IS catalogued, so the node names it rather than printing the path.
      await expect(node(page, `Name is ${marker}`)).toBeVisible()
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('an A/B split gets its first step through "Add steps here"', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-042 split ${Date.now()}`)
    try {
      await login(page, 'admin')
      await openEditor(page, campaignId)

      await paletteButton(page, 'Customer registered').click()
      await paletteButton(page, 'A/B split').click()
      const addHere = page.getByRole('button', { name: 'Add steps here' })
      await expect(addHere.first()).toBeVisible()
      const lanes = await addHere.count()
      expect(lanes).toBeGreaterThanOrEqual(2)

      await addHere.first().click()
      await expect(page.getByText(/Adds to variant/)).toBeVisible()
      await paletteButton(page, 'Add score points').click()
      await fillControlledInput(page.locator('#param-points'), '3')

      const saved = await saveAndRead(page, request, token, campaignId)
      const split = saved.definition.steps.find((step) => step.type === 'split') as Step | undefined
      expect(split, 'the split is saved').toBeTruthy()
      const variants = (split?.params as { variants?: Array<{ key: string; steps: Step[] }> } | undefined)?.variants
        ?? split?.variants
        ?? []
      expect(variants.length).toBe(lanes)
      expect(variants[0].steps.map((step) => [step.type, step.params.points])).toEqual([['add_points', 3]])
      expect(variants.slice(1).every((variant) => variant.steps.length === 0)).toBe(true)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('send rules are switched on in the side panel and saved with the campaign', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-042 rules ${Date.now()}`)
    try {
      await login(page, 'admin')
      await openEditor(page, campaignId)

      await page.getByText('Do not send during quiet hours').click()
      await expect(page.locator('#policy-quiet-start')).toHaveValue('21')
      await fillControlledInput(page.locator('#policy-quiet-start'), '22')
      await page.getByText('Limit how many messages one customer receives').click()
      await expect(page.locator('#policy-cap-max')).toHaveValue('3')

      const saved = await saveAndRead(page, request, token, campaignId)
      expect(saved.definition).toMatchObject({
        sendPolicy: {
          quietHours: { startHour: 22, endHour: 8 },
          frequencyCap: { maxMessages: 3, windowHours: 24 },
        },
      })
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('leaving with unsaved changes asks first, and staying keeps the work', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const campaignId = await createCampaign(request, token, `TC-MA-042 guard ${Date.now()}`)
    try {
      await login(page, 'admin')
      await openEditor(page, campaignId)

      await fillControlledInput(page.locator('#campaign-name'), 'TC-MA-042 not saved')
      await page.getByRole('link', { name: 'Campaigns' }).first().click()
      await confirmDialog(page, 'Cancel')
      await expect(page).toHaveURL(new RegExp(`/backend/marketing/campaigns/${campaignId}$`))
      await expect(page.locator('#campaign-name')).toHaveValue('TC-MA-042 not saved')

      await page.getByRole('link', { name: 'Campaigns' }).first().click()
      await confirmDialog(page, 'Confirm')
      await page.waitForURL(/\/backend\/marketing\/campaigns$/, { timeout: 20_000 })
      expect((await getCampaign(request, token, campaignId)).name).not.toBe('TC-MA-042 not saved')
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('publishing states the reach first, and cancelling it publishes nothing', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `TC-MA-042 publish ${Date.now()}`
    const campaignId = await createCampaign(request, token, marker)
    try {
      // Built through the API: this test is about the publish dialog, and the canvas is covered above. The audience
      // names nobody, so enabling it cannot touch another spec's customers.
      const detail = await getCampaign(request, token, campaignId)
      const graph = await saveGraph(request, token, campaignId, {
        updatedAt: detail.updatedAt,
        name: marker,
        triggers: [{ kind: 'event', eventId: 'customers.person.created' }],
        definition: {
          version: 1,
          audience: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: `${marker} nobody` }] },
          steps: [{ id: 'step-points', type: 'add_points', params: { points: 1 } }],
        },
      })
      expect(graph.status()).toBe(200)

      await login(page, 'admin')
      await openEditor(page, campaignId)

      await page.getByRole('button', { name: 'Enable', exact: true }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('Publish this campaign?')
      await expect(dialog).toContainText('Nobody is messaged until the trigger fires.')
      await expect(dialog).toContainText('no sending step')
      await confirmDialog(page, 'Cancel')
      expect((await getCampaign(request, token, campaignId)).isEnabled).toBe(false)

      await page.getByRole('button', { name: 'Enable', exact: true }).click()
      await confirmDialog(page, 'Confirm')
      await expect(page.getByRole('button', { name: 'Disable', exact: true })).toBeVisible({ timeout: 20_000 })
      expect((await getCampaign(request, token, campaignId)).isEnabled).toBe(true)

      // Switching off is the safe direction and asks nothing.
      await page.getByRole('button', { name: 'Disable', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Enable', exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('alertdialog')).toBeHidden()
      expect((await getCampaign(request, token, campaignId)).isEnabled).toBe(false)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a template creates a disabled campaign and opens it; the list can delete it', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      await login(page, 'admin')
      const templates = page.waitForResponse((response) =>
        response.url().includes('/api/marketing_automation/templates') && response.request().method() === 'GET')
      await page.goto('/backend/marketing/campaigns', { waitUntil: 'domcontentloaded' })
      await templates

      await page.getByText('Start from a template…').click()
      await page.getByRole('option', { name: 'Welcome a new customer' }).click()

      await page.waitForURL(/\/backend\/marketing\/campaigns\/[0-9a-f-]{36}$/, { timeout: 20_000 })
      campaignId = page.url().split('/').pop() ?? null
      const created = await getCampaign(request, token, campaignId!)
      expect(created.isEnabled).toBe(false)
      expect(created.definition.steps.length).toBeGreaterThan(0)
      await expect(page.getByRole('button', { name: 'Enable', exact: true })).toBeVisible({ timeout: 20_000 })

      const listed = page.waitForResponse((response) =>
        response.url().includes(CAMPAIGNS_PATH) && response.request().method() === 'GET')
      await page.goto('/backend/marketing/campaigns', { waitUntil: 'domcontentloaded' })
      await listed
      const row = page.getByRole('row', { name: new RegExp(created.name) }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })
      await row.getByRole('button', { name: 'Open actions' }).click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      await confirmDialog(page, 'Confirm')

      await expect.poll(async () => {
        const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${campaignId}`, { token })
        return response.status()
      }, { timeout: 20_000 }).toBe(404)
      campaignId = null
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })
})
