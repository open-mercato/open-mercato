/** @jest-environment node */
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const granted: { features: string[]; superAdmin: boolean } = { features: [], superAdmin: false }
const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) =>
  granted.superAdmin || required.every((feature) => granted.features.some((entry) => entry === feature || (entry.endsWith('.*') && feature.startsWith(entry.slice(0, -1))))),
)

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('../api/routeContext', () => {
  const { CrudHttpError } = jest.requireActual('@open-mercato/shared/lib/crud/errors')
  return {
    resolveStaffContext: jest.fn(async () => ({
      ctx: { container: { resolve: () => ({ userHasAllFeatures }) }, auth: { sub: 'user-1', isSuperAdmin: granted.superAdmin } },
      em: { fork: () => ({}) },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      translate: (_key: string, fallback: string) => fallback,
      permitted: null,
    })),
    handleRouteError: jest.fn(async (err: unknown) => {
      if (err instanceof CrudHttpError) return { body: err.body, status: err.status }
      throw err
    }),
    guardedCommandInput: jest.fn(),
    runStaffGuard: jest.fn(),
  }
})
jest.mock('../lib/settings', () => ({
  loadSettingsRecord: jest.fn(async () => ({ id: 'settings-1', updatedAt: new Date('2026-11-01T10:00:00Z') })),
  settingsValuesOf: jest.fn(() => ({
    billingChannelId: '44444444-4444-4444-8444-444444444444',
    cancelledOrderStatusEntryId: null,
    leaseEndingThresholdDays: 60,
    bookingReminderMinutes: 60,
    proposalExpiryDays: 21,
  })),
}))
jest.mock('../commands/settings', () => ({ SETTINGS_RESOURCE_KIND: 'property_management.settings' }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}` })),
}))

import { GET, PUT, metadata } from '../api/settings/route'
import { resolveStaffContext } from '../api/routeContext'
import { localToday } from '../lib/leaseTerm'

type RouteResult = { status: number; body: Record<string, unknown> }

async function read(): Promise<RouteResult> {
  return (await GET(new Request('http://localhost/api/property_management/settings'))) as unknown as RouteResult
}

describe('settings GET access', () => {
  beforeEach(() => {
    granted.features = []
    granted.superAdmin = false
    userHasAllFeatures.mockClear()
  })

  it('lets any property viewer reach the handler, which decides on the finer features', () => {
    expect(metadata.GET.requireFeatures).toEqual(['property_management.view'])
    expect(metadata.PUT.requireFeatures).toEqual(['property_management.manage', 'property_management.buildings.manage_all'])
  })

  it('returns every setting to a property manager', async () => {
    granted.features = ['property_management.manage']
    const response = await read()
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: 'settings-1', proposalExpiryDays: 21, billingChannelConfigured: true, leaseEndingThresholdDays: 60 })
    expect(response.body.billingChannelId).toBe('44444444-4444-4444-8444-444444444444')
    expect(response.body.canEdit).toBe(false)
  })

  it('marks the settings editable only for a manager of every building', async () => {
    granted.features = ['property_management.manage', 'property_management.buildings.manage_all']
    const response = await read()
    expect(response.body.canEdit).toBe(true)
  })

  it('returns a read-only subset to a leases-only role', async () => {
    granted.features = ['property_management.leases.manage']
    const response = await read()
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ readOnly: true, proposalExpiryDays: 21, billingChannelConfigured: true, today: localToday() })
  })

  it('honours wildcard grants through the rbac service', async () => {
    granted.features = ['property_management.*']
    const response = await read()
    expect(response.body.billingChannelId).toBeDefined()
    expect(response.body.canEdit).toBe(true)
  })

  it('lets a super admin read every setting, as decided by the rbac service', async () => {
    granted.superAdmin = true
    const response = await read()
    expect(response.body.billingChannelId).toBeDefined()
    expect(response.body.canEdit).toBe(true)
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['property_management.manage'], scope)
  })

  it('does not shortcut a super admin flag past the rbac service', async () => {
    const auth = { sub: 'user-1', isSuperAdmin: true }
    jest.mocked(resolveStaffContext).mockResolvedValueOnce({
      ctx: { container: { resolve: () => ({ userHasAllFeatures: async () => false }) }, auth },
      em: { fork: () => ({}) },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      translate: (_key: string, fallback?: string) => fallback ?? _key,
      permitted: null,
    } as never)
    const response = await read()
    expect(response.status).toBe(403)
  })

  it('returns the deployment date as today in both shapes', async () => {
    granted.features = ['property_management.manage']
    expect((await read()).body.today).toBe(localToday())
    granted.features = ['property_management.leases.manage']
    expect((await read()).body.today).toBe(localToday())
  })

  it('refuses a viewer without either feature', async () => {
    granted.features = ['property_management.view']
    const response = await read()
    expect(response.status).toBe(403)
  })
})

describe('settings PUT validation', () => {
  async function save(body: Record<string, unknown>): Promise<RouteResult> {
    const request = new Request('http://localhost/api/property_management/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ billingChannelId: null, cancelledOrderStatusEntryId: null, leaseEndingThresholdDays: 60, bookingReminderMinutes: 60, proposalExpiryDays: 21, ...body }),
    })
    return (await PUT(request)) as unknown as RouteResult
  }

  it('returns translated field errors for out-of-range limits', async () => {
    const response = await save({ leaseEndingThresholdDays: 0, bookingReminderMinutes: 2000, proposalExpiryDays: 91 })
    expect(response.status).toBe(422)
    expect(response.body.fieldErrors).toEqual({
      leaseEndingThresholdDays: 't:property_management.errors.leaseEndingThresholdInvalid:Enter a whole number of days from 1 to 365.',
      bookingReminderMinutes: 't:property_management.errors.bookingReminderInvalid:Enter a whole number of minutes from 5 to 1440.',
      proposalExpiryDays: 't:property_management.errors.proposalExpiryInvalid:Enter a whole number of days from 1 to 90.',
    })
  })

  it('never returns a raw zod message as a field error', async () => {
    const response = await save({ billingChannelId: 'not-a-uuid', leaseEndingThresholdDays: 1.5 })
    expect(response.status).toBe(422)
    expect(response.body.fieldErrors).toEqual({
      billingChannelId: 't:property_management.errors.invalidInput:Invalid input',
      leaseEndingThresholdDays: 't:property_management.errors.leaseEndingThresholdInvalid:Enter a whole number of days from 1 to 365.',
    })
    expect(response.body).not.toHaveProperty('issues')
  })
})
