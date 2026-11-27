import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'directory'] }

const interactionsPath = '/api/customers/interactions'
const peoplePath = '/api/customers/people'

type AppointmentList = {
  items: Array<{ id: string; organizationId: string }>
  nextCursor?: string
}

test('TC-CAL-4316: appointment overlap is scoped and paged by owner or internal participant', async ({ request }) => {
  const admin = await getAuthToken(request, 'admin')
  const root = await getAuthToken(request, 'superadmin')
  const { tenantId, userId } = getTokenScope(admin)
  const marker = `tc4316-${randomUUID()}`
  const fixtureRecords: Array<{ path: string; id: string; orgId: string }> = []
  const scope = (orgId: string) => ({
    token: root,
    headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${orgId}` },
  })
  const create = async (path: string, orgId: string, data: Record<string, unknown>) => {
    const response = await apiRequest(request, 'POST', path, { ...scope(orgId), data })
    const body = await readJsonSafe<{ id?: string }>(response)
    if (body?.id) fixtureRecords.push({ path, id: body.id, orgId })
    expect(response.status(), `POST ${path} should create the fixture`).toBe(201)
    return expectId(body?.id, `Expected an ID for ${path}`)
  }
  const read = async (params: URLSearchParams, selectedOrg = '__all__') => {
    const response = await apiRequest(request, 'GET', `${interactionsPath}?${params}`, scope(selectedOrg))
    const body = await readJsonSafe<AppointmentList>(response)
    expect(response.status(), `GET ${interactionsPath} should succeed`).toBe(200)
    expect(Array.isArray(body?.items)).toBe(true)
    return body!
  }

  const fixtureOrganizationIds: string[] = []
  try {
    const organizationId = await createOrganizationFixture(request, root, { tenantId, name: `${marker}-home` })
    fixtureOrganizationIds.push(organizationId)
    const otherOrgId = await createOrganizationFixture(request, root, { tenantId, name: `${marker}-other` })
    fixtureOrganizationIds.push(otherOrgId)
    const childOrgId = await createOrganizationFixture(request, root, { tenantId, name: `${marker}-child`, parentId: organizationId })
    fixtureOrganizationIds.push(childOrgId)
    const personId = await create(peoplePath, organizationId, {
      firstName: 'Appointment', lastName: marker, displayName: marker,
    })
    const otherPersonId = await create(peoplePath, otherOrgId, {
      firstName: 'Appointment', lastName: marker, displayName: marker,
    })
    const childPersonId = await create(peoplePath, childOrgId, {
      firstName: 'Appointment', lastName: marker, displayName: marker,
    })
    const from = '2026-03-29T20:00:00Z'
    const to = '2026-03-29T22:00:00Z'
    const base = { entityId: personId, interactionType: 'meeting', title: marker, status: 'planned' }
    const createAppointment = (data: Record<string, unknown>) => create(interactionsPath, organizationId, { ...base, ...data })

    const spanning = await createAppointment({
      ownerUserId: userId, scheduledAt: '2026-03-29T19:45:00Z', durationMinutes: 45,
    })
    const attendee = await createAppointment({
      participants: [{ userId: userId.toUpperCase() }], occurredAt: '2026-03-29T21:10:00Z', durationMinutes: 15,
    })
    const allDay = await createAppointment({
      ownerUserId: userId, date: '2026-03-29', allDay: true, timezone: 'Europe/Warsaw',
    })
    const legacyAllDay = await createAppointment({
      ownerUserId: userId, scheduledAt: '2026-03-30T10:00:00Z', allDay: true,
    })
    await createAppointment({ ownerUserId: userId, scheduledAt: '2026-03-29T19:30:00Z', durationMinutes: 30 })
    await createAppointment({ ownerUserId: userId, scheduledAt: to, durationMinutes: 30 })
    await createAppointment({ authorUserId: userId, scheduledAt: from, durationMinutes: 30 })
    await createAppointment({
      participants: [{ email: `${marker}@example.com` }], scheduledAt: from, durationMinutes: 30,
    })
    await createAppointment({
      authorUserId: userId, ownerUserId: userId, interactionType: 'email', visibility: 'private', scheduledAt: from,
    })
    const series = await createAppointment({
      ownerUserId: userId, scheduledAt: '2026-03-22T19:45:00Z', durationMinutes: 45,
      recurrenceRule: 'FREQ=WEEKLY;COUNT=3', recurrenceEnd: '2026-03-29T19:45:00Z',
    })
    const other = await create(interactionsPath, otherOrgId, {
      ...base, entityId: otherPersonId, ownerUserId: userId, scheduledAt: from, durationMinutes: 30,
    })
    const child = await create(interactionsPath, childOrgId, {
      ...base, entityId: childPersonId, ownerUserId: userId, scheduledAt: from, durationMinutes: 30,
    })

    const query = new URLSearchParams({ organizationId, actorUserId: userId, from, to, overlap: 'true', limit: '1' })
    const found: string[] = []
    for (let page = 0; page < 4; page += 1) {
      const result = await read(query)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.organizationId).toBe(organizationId)
      found.push(result.items[0]!.id)
      if (!result.nextCursor) break
      query.set('cursor', result.nextCursor)
    }
    expect(found.sort()).toEqual([spanning, attendee, allDay].sort())

    const otherScope = new URLSearchParams({ ...Object.fromEntries(query), organizationId: otherOrgId })
    otherScope.delete('cursor')
    expect((await read(otherScope)).items.map(({ id }) => id)).toEqual([other])
    const forbidden = await apiRequest(request, 'GET', `${interactionsPath}?${otherScope}`, scope(organizationId))
    expect(forbidden.status()).toBe(403)
    const childScope = new URLSearchParams(otherScope)
    childScope.set('organizationId', childOrgId)
    expect((await read(childScope, organizationId)).items.map(({ id }) => id)).toEqual([child])

    query.delete('cursor')
    query.set('limit', '100')
    query.set('recurrenceMasters', 'true')
    expect((await read(query)).items.map(({ id }) => id)).toEqual([series])
    query.delete('recurrenceMasters')
    query.delete('overlap')
    expect((await read(query)).items.map(({ id }) => id)).not.toContain(spanning)

    query.set('overlap', 'true')
    query.set('from', to)
    query.set('to', '2026-03-29T22:30:00Z')
    const utcAppointments = (await read(query)).items.map(({ id }) => id)
    expect(utcAppointments).not.toContain(allDay)
    expect(utcAppointments).not.toContain(legacyAllDay)
    query.set('overlapTimezone', 'Europe/Warsaw')
    expect((await read(query)).items.map(({ id }) => id)).toContain(legacyAllDay)

    const beforeRepeatedMidnight = await createAppointment({
      ownerUserId: userId, date: '2026-10-31', allDay: true, timezone: 'America/Havana',
    })
    const startsAtRepeatedMidnight = await createAppointment({
      ownerUserId: userId, date: '2026-11-01', allDay: true, timezone: 'America/Havana',
    })
    query.set('from', '2026-11-01T04:15:00Z')
    query.set('to', '2026-11-01T04:30:00Z')
    const atRepeatedMidnight = (await read(query)).items.map(({ id }) => id)
    expect(atRepeatedMidnight).toContain(startsAtRepeatedMidnight)
    expect(atRepeatedMidnight).not.toContain(beforeRepeatedMidnight)
  } finally {
    for (const { path, id, orgId } of fixtureRecords.reverse()) {
      await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, scope(orgId)).catch(() => undefined)
    }
    for (const orgId of fixtureOrganizationIds.reverse()) {
      await deleteOrganizationIfExists(request, root, orgId)
    }
  }
})
