// NOTE: mutates the tenant-singleton incident_settings row — run serially with other
// settings-mutating incidents specs (workers=1), mirroring the repo's serial-suite convention.
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const TRIGGERS_API = '/api/incidents/triggers'
const SEVERITIES_API = '/api/incidents/severities'
const SETTINGS_API = '/api/incidents/settings'
const EVENTS_API = '/api/events?excludeTriggerExcluded=true'

type ListResponse<T> = {
  items?: T[]
}

type EventDefinition = {
  id: string
  label?: string | null
  module?: string | null
  excludeFromTriggers?: boolean | null
}

type TriggerRecord = {
  id: string
  event_id?: string | null
  updated_at?: string | null
}

type SeverityRecord = {
  id: string
  key?: string | null
  label?: string | null
  is_active?: boolean | null
}

type SettingsRecord = {
  id: string
  sla_targets?: unknown
  update_cadence?: unknown
}

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

function cssAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function fetchEvents(request: APIRequestContext, token: string): Promise<EventDefinition[]> {
  const response = await apiRequest(request, 'GET', EVENTS_API, { token })
  expect(response.status(), 'GET /api/events should succeed').toBe(200)
  const body = await readJsonSafe<{ data?: EventDefinition[] }>(response)
  return (body?.data ?? []).filter((event) => {
    const moduleId = event.module ?? event.id.split('.')[0]
    return event.id && moduleId !== 'incidents' && !event.id.startsWith('incidents.') && event.excludeFromTriggers !== true
  })
}

async function fetchTriggers(request: APIRequestContext, token: string): Promise<TriggerRecord[]> {
  const response = await apiRequest(request, 'GET', `${TRIGGERS_API}?page=1&pageSize=100`, { token })
  expect(response.status(), 'GET /api/incidents/triggers should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<TriggerRecord>>(response)
  return itemsFrom(body)
}

async function pickUnusedEvent(request: APIRequestContext, token: string): Promise<EventDefinition> {
  const [events, triggers] = await Promise.all([fetchEvents(request, token), fetchTriggers(request, token)])
  const used = new Set(triggers.map((trigger) => trigger.event_id).filter((value): value is string => !!value))
  const labelCounts = new Map<string, number>()
  for (const event of events) {
    const label = event.label?.trim() || event.id
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }
  const event = events.find((candidate) => !used.has(candidate.id) && labelCounts.get(candidate.label?.trim() || candidate.id) === 1)
    ?? events.find((candidate) => !used.has(candidate.id))
  test.skip(!event, 'No unused non-incidents event is available for trigger UI coverage.')
  return event!
}

async function fetchFirstSeverity(request: APIRequestContext, token: string): Promise<SeverityRecord> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'GET /api/incidents/severities should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  const severity = itemsFrom(body).find((item) => item.id && item.key)
  expect(severity, 'at least one active severity should exist').toBeTruthy()
  return severity!
}

async function fetchSettings(request: APIRequestContext, token: string): Promise<SettingsRecord> {
  const response = await apiRequest(request, 'GET', `${SETTINGS_API}?page=1&pageSize=5`, { token })
  expect(response.status(), 'GET /api/incidents/settings should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<SettingsRecord>>(response)
  const settings = itemsFrom(body)[0]
  expect(settings?.id, 'settings row should exist').toBeTruthy()
  return settings!
}

async function restoreSettings(
  request: APIRequestContext,
  token: string,
  settings: SettingsRecord | null,
  scope: { organizationId: string; tenantId: string },
): Promise<void> {
  if (!settings?.id) return
  await apiRequest(request, 'PUT', SETTINGS_API, {
    token,
    data: {
      id: settings.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      slaTargets: settings.sla_targets ?? null,
      updateCadence: settings.update_cadence ?? null,
    },
  }).catch(() => undefined)
}

async function findTriggerByEvent(request: APIRequestContext, token: string, eventId: string): Promise<TriggerRecord | null> {
  const response = await apiRequest(request, 'GET', `${TRIGGERS_API}?eventId=${encodeURIComponent(eventId)}`, { token })
  if (!response.ok()) return null
  const body = await readJsonSafe<ListResponse<TriggerRecord>>(response)
  return itemsFrom(body).find((trigger) => trigger.event_id === eventId) ?? null
}

async function deleteTriggerIfExists(request: APIRequestContext, token: string, id: string | null): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `${TRIGGERS_API}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

async function waitForSettingsSave(page: Page, click: () => Promise<void>): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/incidents/settings') &&
      response.request().method() === 'PUT' &&
      response.status() === 200,
    ),
    click(),
  ])
}

test.describe('TC-INC-013: Incident settings UI trigger manager', () => {
  test('adds, disables, edits SLA response minutes, persists, and deletes a trigger', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    const originalSettings = await fetchSettings(request, token)
    const severity = await fetchFirstSeverity(request, token)
    const event = await pickUnusedEvent(request, token)
    const eventLabel = event.label?.trim() || event.id
    let triggerId: string | null = null

    try {
      await login(page, 'admin')
      await page.goto('/backend/incidents/settings', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /Incident settings/i })).toBeVisible()
      await expect(page.getByText('Automatic incident triggers')).toBeVisible()

      await page.getByRole('button', { name: /Add trigger/i }).click()
      const dialog = page.getByRole('dialog', { name: /Create incident trigger/i })
      await expect(dialog).toBeVisible()

      await dialog.getByRole('combobox').first().click()
      await page.getByRole('option', { name: eventLabel, exact: true }).click()

      await dialog.getByLabel('Severity').click()
      await page.getByRole('option').filter({ hasText: severity.label ?? severity.key ?? '' }).first().click()

      await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes('/api/incidents/triggers') &&
          response.request().method() === 'POST' &&
          response.status() === 201,
        ),
        dialog.getByRole('button', { name: /^Save$/ }).click(),
      ])

      const row = page.locator('li').filter({ hasText: event.id }).first()
      await expect(row, 'created trigger row should render the event id').toBeVisible()
      triggerId = (await findTriggerByEvent(request, token, event.id))?.id ?? null
      expect(triggerId, 'created trigger should be discoverable through the API').toBeTruthy()

      const enabledSwitch = row.getByRole('switch', { name: /Enabled/i })
      await expect(enabledSwitch).toHaveAttribute('aria-checked', 'true')
      await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes('/api/incidents/triggers') &&
          response.request().method() === 'PUT' &&
          response.status() === 200,
        ),
        enabledSwitch.click(),
      ])
      await expect(enabledSwitch, 'disable toggle should persist visually').toHaveAttribute('aria-checked', 'false')

      const responseInput = page.locator(`[id="${cssAttr(`incident-sla-response-${severity.key}`)}"]`)
      await expect(responseInput, 'SLA response minutes input should be visible').toBeVisible()
      const currentValue = Number(await responseInput.inputValue())
      const nextValue = Number.isFinite(currentValue) && currentValue > 0 ? currentValue + 3 : 18
      await responseInput.fill(String(nextValue))
      await waitForSettingsSave(page, async () => {
        await page.getByRole('button', { name: /^Save$/ }).first().click()
      })

      await page.reload({ waitUntil: 'domcontentloaded' })
      const reloadedInput = page.locator(`[id="${cssAttr(`incident-sla-response-${severity.key}`)}"]`)
      await expect(reloadedInput, 'SLA response minutes should persist after reload').toHaveValue(String(nextValue))

      const reloadedRow = page.locator('li').filter({ hasText: event.id }).first()
      await expect(reloadedRow).toBeVisible()
      await reloadedRow.getByRole('button', { name: /^Delete$/ }).click()
      await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes('/api/incidents/triggers') &&
          response.request().method() === 'DELETE' &&
          response.status() === 200,
        ),
        page.getByRole('button', { name: /Delete trigger/i }).click(),
      ])
      await expect(page.locator('li').filter({ hasText: event.id }).first(), 'deleted trigger row should disappear').toHaveCount(0)
      triggerId = null
    } finally {
      await deleteTriggerIfExists(request, token, triggerId)
      await restoreSettings(request, token, originalSettings, scope)
    }
  })
})
