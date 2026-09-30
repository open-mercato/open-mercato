import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'

export const integrationMeta = { dependsOnModules: ['example', 'customers', 'planner', 'resources', 'staff'] }

const START = '2026-10-05T09:00:00.000Z'
const END = '2026-10-05T10:00:00.000Z'

test.describe('TC-EXAMPLE-018: Visit availability API and direct write guard', () => {
  test('mounts the Visit panel without changing the default type choices', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/calendar')
    await page.getByRole('button', { name: 'New event' }).click()
    const dialog = page.getByRole('dialog', { name: 'New event' })
    const typeChoices = dialog.getByRole('group', { name: 'Event type' })
    await expect(typeChoices.getByRole('button', { name: 'Meeting', exact: true })).toBeVisible()
    await expect(typeChoices.getByRole('button', { name: 'Note', exact: true })).toBeVisible()
    await typeChoices.getByRole('button', { name: 'Visit' }).click()
    await expect(dialog.getByTestId('example-visit-panel')).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Visit availability' })).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: 'Starts', exact: true })).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: 'Ends', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save event' })).toBeVisible()
  })

  test('previews an unscheduled resource and rejects direct create/update while preserving the Visit', async ({ request }) => {
    test.setTimeout(60_000)
    let token: string | null = null
    let personId: string | null = null
    let resourceId: string | null = null
    let visitId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = Date.now()
      personId = await createPersonFixture(request, token, {
        firstName: 'Visit', lastName: `QA${stamp}`, displayName: `Visit QA ${stamp}`,
      })
      const resource = await apiRequest(request, 'POST', '/api/resources/resources', {
        token, data: { name: `Visit QA room ${stamp}`, isActive: true },
      })
      expect(resource.status(), await resource.text()).toBe(201)
      resourceId = (await resource.json() as { id?: string }).id ?? null
      expect(resourceId).toBeTruthy()

      const catalogResponse = await apiRequest(request, 'GET', '/api/customers/activity-types', { token })
      expect(catalogResponse.status(), await catalogResponse.text()).toBe(200)
      const catalog = await catalogResponse.json() as { items: Array<{ key: string; label: string; selectable: boolean; panelKey?: string; labelKey?: string }> }
      expect(catalog.items.find((item) => item.key === 'visit')).toMatchObject({ selectable: true, panelKey: 'example.visit' })
      expect(catalog.items.find((item) => item.key === 'meeting')).toMatchObject({ selectable: true })
      expect(catalog.items.find((item) => item.key === 'note')).toMatchObject({ selectable: true })

      const query = new URLSearchParams({ startAt: START, endAt: END, resourceIds: resourceId! })
      const preview = await apiRequest(request, 'GET', `/api/example/visit-availability?${query.toString()}`, { token })
      expect(preview.status(), await preview.text()).toBe(200)
      expect(await preview.json()).toEqual({ subjects: [{
        type: 'resource', id: resourceId, displayName: `Visit QA room ${stamp}`, status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.noSchedule',
      }], warnings: [] })

      const visitInput = { entityId: personId, interactionType: 'visit', title: `Visit QA ${stamp}`, scheduledAt: START, durationMinutes: 60 }
      const rejected = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { ...visitInput, linkedEntities: [{ type: 'resource', id: resourceId, label: `Visit QA room ${stamp}` }] },
      })
      expect(rejected.status()).toBe(422)
      expect(await rejected.json()).toMatchObject({ code: 'visit_availability_unavailable', fields: ['linkedEntities'] })

      const accepted = await apiRequest(request, 'POST', '/api/customers/interactions', { token, data: visitInput })
      expect(accepted.status(), await accepted.text()).toBe(201)
      visitId = (await accepted.json() as { id?: string }).id ?? null
      expect(visitId).toBeTruthy()

      const titleUpdate = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: visitId, title: `Renamed Visit QA ${stamp}` },
      })
      expect(titleUpdate.status(), await titleUpdate.text()).toBe(200)

      const update = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token,
        data: { id: visitId, linkedEntities: [{ type: 'resource', id: resourceId, label: `Visit QA room ${stamp}` }] },
      })
      expect(update.status()).toBe(422)
      expect(await update.json()).toMatchObject({ code: 'visit_availability_unavailable', fields: ['linkedEntities'] })

      const list = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${personId}&from=2026-10-05T00%3A00%3A00Z&to=2026-10-06T00%3A00%3A00Z`, { token })
      expect(list.status(), await list.text()).toBe(200)
      const row = ((await list.json()) as { items?: Array<{ id: string; linkedEntities?: unknown[] }> }).items?.find((item) => item.id === visitId)
      expect(row).toBeTruthy()
      expect(row?.linkedEntities ?? []).toEqual([])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', visitId)
      await deleteEntityIfExists(request, token, '/api/resources/resources', resourceId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})

const scheduleCases = [
  { kind: 'staff', repeat: 'weekly', timezone: 'Europe/Warsaw', anchor: '20261006T070000Z', weekday: 'TU',
    startAt: '2026-09-29T09:15:00+02:00', endAt: '2026-09-29T12:00:00+02:00',
    rejectedStartAt: '2026-09-29T13:15:00+02:00', rejectedEndAt: '2026-09-29T14:00:00+02:00' },
  { kind: 'staff', repeat: 'once', timezone: 'Europe/Warsaw', anchor: '20260929T070000Z', weekday: 'TU',
    startAt: '2026-09-29T09:15:00+02:00', endAt: '2026-09-29T12:00:00+02:00',
    rejectedStartAt: '2026-09-30T09:15:00+02:00', rejectedEndAt: '2026-09-30T12:00:00+02:00' },
  { kind: 'resource', repeat: 'weekly', timezone: 'UTC', anchor: '20261006T090000Z', weekday: 'TU',
    startAt: '2026-09-29T09:15:00Z', endAt: '2026-09-29T12:00:00Z',
    rejectedStartAt: '2026-09-29T13:15:00Z', rejectedEndAt: '2026-09-29T14:00:00Z' },
  { kind: 'resource', repeat: 'once', timezone: 'UTC', anchor: '20260929T090000Z', weekday: 'TU',
    startAt: '2026-09-29T09:15:00Z', endAt: '2026-09-29T12:00:00Z',
    rejectedStartAt: '2026-09-30T09:15:00Z', rejectedEndAt: '2026-09-30T12:00:00Z' },
  { kind: 'staff', repeat: 'weekly-dst', timezone: 'Europe/Warsaw', anchor: '20260322T080000Z', weekday: 'SU',
    startAt: '2026-03-29T09:15:00+02:00', endAt: '2026-03-29T12:00:00+02:00',
    rejectedStartAt: '2026-03-29T13:15:00+02:00', rejectedEndAt: '2026-03-29T14:00:00+02:00' },
] as const

for (const schedule of scheduleCases) {
  test(`TC-EXAMPLE-018: ${schedule.kind} ${schedule.repeat} ${schedule.timezone} availability previews and guards`, async ({ request }) => {
    test.setTimeout(60_000)
    let token: string | null = null
    let personId: string | null = null
    let staffUserId: string | null = null
    let subjectId: string | null = null
    let ruleId: string | null = null
    let visitId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-${schedule.kind}-${schedule.repeat}`
      personId = await createPersonFixture(request, token, { firstName: 'Availability', lastName: stamp, displayName: `QA availability ${stamp}` })
      if (schedule.kind === 'staff') {
        staffUserId = await createUserFixture(request, token, {
          email: `visit-availability-${stamp}@example.com`, password: `QA-${stamp}-Secret9!`,
          organizationId: getTokenScope(token).organizationId, roles: [], name: `QA Alex Chen ${stamp}`,
        })
        const member = await apiRequest(request, 'POST', '/api/staff/team-members', {
          token, data: { displayName: `QA Alex Chen ${stamp}`, userId: staffUserId, isActive: true },
        })
        expect(member.status(), await member.text()).toBe(201)
        subjectId = (await member.json() as { id: string }).id
        expect(subjectId).not.toBe(staffUserId)
      } else {
        const resource = await apiRequest(request, 'POST', '/api/resources/resources', {
          token, data: { name: `QA availability room ${stamp}`, isActive: true },
        })
        expect(resource.status(), await resource.text()).toBe(201)
        subjectId = (await resource.json() as { id: string }).id
      }
      const recurrence = schedule.repeat === 'once' ? 'FREQ=DAILY;COUNT=1' : `FREQ=WEEKLY;BYDAY=${schedule.weekday}`
      const rule = await apiRequest(request, 'POST', '/api/planner/availability', {
        token, data: { subjectType: schedule.kind === 'staff' ? 'member' : 'resource', subjectId,
          timezone: schedule.timezone, rrule: `DTSTART:${schedule.anchor}\nDURATION:PT4H\nRRULE:${recurrence}`,
          kind: 'availability', exdates: [] },
      })
      expect(rule.status(), await rule.text()).toBe(201)
      ruleId = (await rule.json() as { id: string }).id
      const selectedId = schedule.kind === 'staff' ? staffUserId! : subjectId!
      const selection = schedule.kind === 'staff'
        ? { participants: [{ userId: staffUserId, name: `QA Alex Chen ${stamp}` }] }
        : { linkedEntities: [{ type: 'resource', id: subjectId, label: `QA availability room ${stamp}` }] }
      for (const [startAt, endAt, expectedStatus] of [
        [schedule.startAt, schedule.endAt, 'available'],
        [schedule.rejectedStartAt, schedule.rejectedEndAt, 'unavailable'],
      ]) {
        const query = new URLSearchParams({ startAt, endAt, [schedule.kind === 'staff' ? 'staffUserIds' : 'resourceIds']: selectedId })
        const preview = await apiRequest(request, 'GET', `/api/example/visit-availability?${query}`, { token })
        expect(preview.status(), await preview.text()).toBe(200)
        expect(await preview.json()).toMatchObject({ subjects: [{ type: schedule.kind, id: selectedId, status: expectedStatus }], warnings: [] })
      }
      const create = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: 'visit', title: `QA visit ${stamp}`,
          scheduledAt: schedule.startAt, durationMinutes: 165, timezone: schedule.timezone, ...selection },
      })
      expect(create.status(), await create.text()).toBe(201)
      visitId = (await create.json() as { id: string }).id
      const durationMinutes = (new Date(schedule.rejectedEndAt).getTime() - new Date(schedule.rejectedStartAt).getTime()) / 60000
      const rejected = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: visitId, scheduledAt: schedule.rejectedStartAt, durationMinutes },
      })
      expect(rejected.status(), await rejected.text()).toBe(422)
      expect(await rejected.json()).toMatchObject({ fields: [schedule.kind === 'staff' ? 'participants' : 'linkedEntities'] })
      const stored = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${personId}&limit=100`, { token })
      expect(stored.status(), await stored.text()).toBe(200)
      const storedItems = await stored.json() as { items: Array<{ id: string; scheduledAt: string; durationMinutes: number }> }
      expect(storedItems.items.find((item) => item.id === visitId)).toMatchObject({
        scheduledAt: new Date(schedule.startAt).toISOString(), durationMinutes: 165,
      })
      const rejectedCreate = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token, data: { entityId: personId, interactionType: 'Visit', title: `Unavailable visit ${stamp}`,
          scheduledAt: schedule.rejectedStartAt, durationMinutes, timezone: schedule.timezone, ...selection },
      })
      expect(rejectedCreate.status(), await rejectedCreate.text()).toBe(422)
      expect(await rejectedCreate.json()).toMatchObject({ fields: [schedule.kind === 'staff' ? 'participants' : 'linkedEntities'] })
      await deleteEntityIfExists(request, token, '/api/planner/availability', ruleId)
      const titleOnly = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: visitId, title: `Renamed visit ${stamp}` },
      })
      expect(titleOnly.status(), await titleOnly.text()).toBe(200)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', visitId)
      await deleteEntityIfExists(request, token, '/api/planner/availability', ruleId)
      await deleteEntityIfExists(request, token, schedule.kind === 'staff' ? '/api/staff/team-members' : '/api/resources/resources', subjectId)
      await deleteUserIfExists(request, token, staffUserId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
}


for (const subjectType of ['staff', 'resource'] as const) {
  test(`TC-EXAMPLE-018: named ${subjectType} bookings block Visit across normal and recurring event types`, async ({ request }) => {
    let token: string | null = null
    let personId: string | null = null
    let staffUserId: string | null = null
    let subjectId: string | null = null
    let ruleId: string | null = null
    const interactionIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-${subjectType}-bookings`
      const subjectName = `QA booked ${subjectType} ${stamp}`
      personId = await createPersonFixture(request, token, { firstName: 'Bookings', lastName: stamp, displayName: `QA bookings ${stamp}` })
      if (subjectType === 'staff') {
        staffUserId = await createUserFixture(request, token, {
          email: `visit-bookings-${stamp}@example.com`, password: `QA-${stamp}-Secret9!`,
          organizationId: getTokenScope(token).organizationId, roles: [], name: subjectName,
        })
        const member = await apiRequest(request, 'POST', '/api/staff/team-members', {
          token, data: { displayName: subjectName, userId: staffUserId, isActive: true },
        })
        expect(member.status(), await member.text()).toBe(201)
        subjectId = (await member.json() as { id: string }).id
      } else {
        const resource = await apiRequest(request, 'POST', '/api/resources/resources', {
          token, data: { name: subjectName, isActive: true },
        })
        expect(resource.status(), await resource.text()).toBe(201)
        subjectId = (await resource.json() as { id: string }).id
      }
      const rule = await apiRequest(request, 'POST', '/api/planner/availability', {
        token, data: { subjectType: subjectType === 'staff' ? 'member' : 'resource', subjectId,
          timezone: 'UTC', rrule: 'DTSTART:20261005T090000Z\nDURATION:PT8H\nRRULE:FREQ=WEEKLY;BYDAY=MO',
          kind: 'availability', exdates: [] },
      })
      expect(rule.status(), await rule.text()).toBe(201)
      ruleId = (await rule.json() as { id: string }).id
      const selectedId = subjectType === 'staff' ? staffUserId! : subjectId!
      const selection = subjectType === 'staff'
        ? { participants: [{ userId: staffUserId, name: subjectName }] }
        : { linkedEntities: [{ type: 'resource', id: subjectId, label: subjectName }] }
      const authToken = token
      const createInteraction = async (interactionType: string, scheduledAt: string, extra: Record<string, unknown> = {}) => {
        const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token: authToken, data: { entityId: personId, interactionType, title: `QA ${interactionType} ${stamp}`,
            scheduledAt, durationMinutes: 60, timezone: 'UTC', ...selection, ...extra },
        })
        expect(response.status(), await response.text()).toBe(201)
        const id = (await response.json() as { id: string }).id
        interactionIds.push(id)
        return id
      }
      const preview = async (startAt: string, endAt: string, status: string, reasonKey: string | null, excludeInteractionId?: string) => {
        const query = new URLSearchParams({ startAt, endAt, [subjectType === 'staff' ? 'staffUserIds' : 'resourceIds']: selectedId })
        if (excludeInteractionId) query.set('excludeInteractionId', excludeInteractionId)
        const response = await apiRequest(request, 'GET', `/api/example/visit-availability?${query}`, { token: authToken })
        expect(response.status(), await response.text()).toBe(200)
        expect(await response.json()).toMatchObject({ subjects: [{ type: subjectType, id: selectedId, displayName: subjectName, status, reasonKey }], warnings: [] })
      }
      const visitId = await createInteraction('visit', '2026-10-05T13:00:00Z')
      await preview('2026-10-05T13:15:00Z', '2026-10-05T14:00:00Z', 'unavailable', 'example.calendar.visitAvailability.booked')
      await preview('2026-10-05T13:15:00Z', '2026-10-05T14:00:00Z', 'available', null, visitId)
      const ownUpdate = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token, data: { id: visitId, scheduledAt: '2026-10-05T13:15:00Z', durationMinutes: 45 },
      })
      expect(ownUpdate.status(), await ownUpdate.text()).toBe(200)

      for (const [interactionType, scheduledAt, extra] of [
        ['meeting', '2026-10-05T09:30:00Z', {}],
        ['event', '2026-09-28T09:30:00Z', { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3' }],
      ] as const) {
        let bookingId = await createInteraction(interactionType, scheduledAt, extra)
        await preview('2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', 'unavailable', 'example.calendar.visitAvailability.booked')
        const blockedSubject = { type: subjectType, id: selectedId, displayName: subjectName, status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.booked' }
        const rejectedCreate = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token, data: { entityId: personId, interactionType: 'visit', title: `Blocked Visit ${stamp}`,
            scheduledAt: '2026-10-05T10:00:00Z', durationMinutes: 60, timezone: 'UTC', ...selection },
        })
        expect(rejectedCreate.status(), await rejectedCreate.text()).toBe(422)
        expect(await rejectedCreate.json()).toMatchObject({ code: 'visit_availability_unavailable',
          fields: [subjectType === 'staff' ? 'participants' : 'linkedEntities'], subjects: [blockedSubject] })
        const rejectedUpdate = await apiRequest(request, 'PUT', '/api/customers/interactions', {
          token, data: { id: visitId, scheduledAt: '2026-10-05T10:00:00Z', durationMinutes: 60 },
        })
        expect(rejectedUpdate.status(), await rejectedUpdate.text()).toBe(422)
        expect(await rejectedUpdate.json()).toMatchObject({ code: 'visit_availability_unavailable', subjects: [blockedSubject] })
        await preview('2026-10-05T10:30:00Z', '2026-10-05T11:30:00Z', 'available', null)
        const canceled = await apiRequest(request, 'PUT', '/api/customers/interactions', { token, data: { id: bookingId, status: 'canceled' } })
        expect(canceled.status(), await canceled.text()).toBe(200)
        await preview('2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', 'available', null)
        await deleteEntityIfExists(request, token, '/api/customers/interactions', bookingId)
        bookingId = await createInteraction(interactionType, scheduledAt, extra)
        await preview('2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', 'unavailable', 'example.calendar.visitAvailability.booked')
        await deleteEntityIfExists(request, token, '/api/customers/interactions', bookingId)
        await preview('2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', 'available', null)
      }
      const stored = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${personId}&limit=100`, { token })
      expect(stored.status(), await stored.text()).toBe(200)
      const storedItems = await stored.json() as { items: Array<{ id: string; scheduledAt: string; durationMinutes: number }> }
      expect(storedItems.items.find((item) => item.id === visitId)).toMatchObject({ scheduledAt: '2026-10-05T13:15:00.000Z', durationMinutes: 45 })
    } finally {
      for (const id of interactionIds) await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
      await deleteEntityIfExists(request, token, '/api/planner/availability', ruleId)
      await deleteEntityIfExists(request, token, subjectType === 'staff' ? '/api/staff/team-members' : '/api/resources/resources', subjectId)
      await deleteUserIfExists(request, token, staffUserId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
}
