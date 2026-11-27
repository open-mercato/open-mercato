import { expect, test as base, type Locator } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { DEFAULT_CREDENTIALS } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildMinimalFormSchema,
  createFormFixture,
  forkDraftFixture,
  updateDraftFixture,
} from '@open-mercato/core/helpers/integration/formsFixtures'

const longLabel = 'Text source with a deliberately long descriptive label for source switching and layout wrapping'

const test = base.extend<{ ownedForm: { token: string; formId: string } }>({
  ownedForm: async ({ request }, runWithOwnedForm, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const form = await createFormFixture(request, token, { name: 'QA8565 label containment' })
    try {
      await runWithOwnedForm({ token, formId: form.id })
    } finally {
      const response = await apiRequest(request, 'DELETE', `/api/forms/${form.id}`, { token })
      await testInfo.attach('fixture-cleanup', {
        body: JSON.stringify({ formId: form.id, status: response.status() }), contentType: 'application/json',
      })
      expect(response.status(), 'the test-owned form is deleted').toBe(200)
    }
  },
})

async function assertControlHitTarget(control: Locator) {
  await expect(control).toBeVisible()
  await expect(control).toBeEnabled()
  expect(await control.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return hit === element || element.contains(hit)
  })).toBe(true)
}

test('TC-FORM-8565: long canvas labels preserve type text and working row actions', async ({ page, request, ownedForm }, testInfo) => {
  const { token, formId } = ownedForm
  const versionId = await forkDraftFixture(request, token, formId)
  const schema = buildMinimalFormSchema()
  schema.properties = {
    before: { type: 'string', 'x-om-type': 'text', 'x-om-label': { en: 'Before long label' } },
    long_label: { type: 'string', 'x-om-type': 'text', 'x-om-label': { en: longLabel } },
    after: { type: 'string', 'x-om-type': 'text', 'x-om-label': { en: 'After long label' } },
  }
  schema.required = []
  schema['x-om-sections'] = [
    { key: 'layout', title: { en: 'Label containment' }, fieldKeys: ['before', 'long_label', 'after'] },
  ]
  await updateDraftFixture(request, token, formId, versionId, { schema, uiSchema: {}, roles: ['admin', 'participant'] })

  await page.setViewportSize({ width: 1600, height: 1100 })
  const browserLogin = await page.request.post('/api/auth/login', { form: DEFAULT_CREDENTIALS.admin })
  expect(browserLogin.status()).toBe(200)
  await page.goto(`/backend/forms/${formId}`)
  const row = page.locator('[data-field-key="long_label"]')
  const label = row.getByText(longLabel, { exact: true })
  await expect(label).toBeVisible()
  const type = row.getByText('Text', { exact: true })
  const moveUp = row.getByRole('button', { name: 'Move field up', exact: true })
  const moveDown = row.getByRole('button', { name: 'Move field down', exact: true })
  const remove = row.getByRole('button', { name: 'Delete field', exact: true })

  for (const width of [1600, 1440]) {
    await page.setViewportSize({ width, height: 1100 })
    await expect(type).toBeVisible()
    const labelBox = await label.boundingBox()
    const typeBox = await type.boundingBox()
    const rowBox = await row.boundingBox()
    const actionBox = await moveUp.boundingBox()
    expect(labelBox).not.toBeNull()
    expect(typeBox).not.toBeNull()
    expect(rowBox).not.toBeNull()
    expect(actionBox).not.toBeNull()
    expect(labelBox!.width).toBeGreaterThan(0)
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(typeBox!.x)
    expect(typeBox!.x + typeBox!.width).toBeLessThanOrEqual(actionBox!.x)
    expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    for (const control of [moveUp, moveDown, remove]) {
      await assertControlHitTarget(control)
      const controlBox = await control.boundingBox()
      expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width)
    }
    await testInfo.attach(`geometry-${width}`, {
      body: JSON.stringify({ labelBox, typeBox, rowBox, actionBox }), contentType: 'application/json',
    })
    await testInfo.attach(`label-containment-${width}`, {
      body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
    })
  }

  await row.getByRole('button', { name: new RegExp(longLabel) }).click()
  await moveUp.click()
  await expect(page.locator('[data-field-key]').first()).toHaveAttribute('data-field-key', 'long_label')
  await moveDown.click()
  await expect(page.locator('[data-field-key]').nth(1)).toHaveAttribute('data-field-key', 'long_label')
  await remove.click()
  await expect(row).toHaveCount(0)
  await expect(page.locator('[data-field-key]')).toHaveCount(2)
  await expect.poll(async () => {
    const response = await apiRequest(request, 'GET', `/api/forms/${formId}/versions/${versionId}`, { token })
    expect(response.status()).toBe(200)
    const version = await readJsonSafe<{ schema?: { properties?: Record<string, unknown> } }>(response)
    return Object.keys(version?.schema?.properties ?? {}).sort()
  }).toEqual(['after', 'before'])
})
