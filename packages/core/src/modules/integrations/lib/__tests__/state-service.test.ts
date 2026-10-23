/** @jest-environment node */

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  clearRegisteredIntegrations,
  registerIntegration,
} from '@open-mercato/shared/modules/integrations/types'
import { createIntegrationStateService, type IntegrationStateService } from '../state-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

type UpsertInput = Parameters<IntegrationStateService['upsert']>[1]

const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const checkedAt = new Date('2026-10-04T00:00:00.000Z')

function createMockEntityManager() {
  const em = {
    create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(() => em),
    flush: jest.fn(async () => undefined),
  }
  return em
}

function createService(existingRow: Record<string, unknown> | null = null) {
  const em = createMockEntityManager()
  mockFindOneWithDecryption.mockResolvedValue(existingRow as never)
  return { em, service: createIntegrationStateService(em as never) }
}

describe('integration state service — missing state row', () => {
  beforeEach(() => {
    clearRegisteredIntegrations()
    mockFindOneWithDecryption.mockReset()
    registerIntegration({ id: 'default_on', title: 'Default on', defaultState: { isEnabled: true } })
    registerIntegration({ id: 'default_off', title: 'Default off' })
  })

  afterEach(() => {
    clearRegisteredIntegrations()
  })

  it('keeps a default-enabled integration enabled when setReauthRequired creates the row', async () => {
    const { em, service } = createService()

    const created = await service.setReauthRequired('default_on', true, scope)

    expect(em.create).toHaveBeenCalledTimes(1)
    expect(created.isEnabled).toBe(true)
    expect(created.reauthRequired).toBe(true)
  })

  it.each<{ writtenBy: string; input: UpsertInput }>([
    { writtenBy: 'admin state route', input: { reauthRequired: true } },
    { writtenBy: 'API version route', input: { apiVersion: '2026-01-01' } },
    {
      writtenBy: 'health service',
      input: { lastHealthStatus: 'healthy', lastHealthCheckedAt: checkedAt, lastHealthLatencyMs: 12 },
    },
    {
      writtenBy: 'data_sync telemetry and run cancel',
      input: { lastHealthStatus: 'degraded', lastHealthCheckedAt: checkedAt },
    },
  ])('resolves the same enabled state before and after the $writtenBy write shape creates the row', async ({ input }) => {
    const { service } = createService()
    const before = await service.resolveState('default_on', scope)

    const created = await service.upsert('default_on', input, scope)
    mockFindOneWithDecryption.mockResolvedValue(created as never)
    const after = await service.resolveState('default_on', scope)

    expect(before.isEnabled).toBe(true)
    expect(created.isEnabled).toBe(true)
    expect(after.isEnabled).toBe(true)
    expect(after.enabledAt).toBeNull()
  })

  it('creates the row disabled when the integration declares no default state', async () => {
    const { service } = createService()

    const created = await service.upsert('default_off', { reauthRequired: true }, scope)

    expect(created.isEnabled).toBe(false)
    expect(created.enabledAt).toBeUndefined()
  })

  it('lets an explicit isEnabled override the default state when it creates the row', async () => {
    const disabled = await createService().service.upsert('default_on', { isEnabled: false }, scope)
    const enabled = await createService().service.upsert('default_off', { isEnabled: true }, scope)

    expect(disabled.isEnabled).toBe(false)
    expect(enabled.isEnabled).toBe(true)
    expect(enabled.enabledAt).toBeInstanceOf(Date)
  })

  it('keeps the stored isEnabled of an existing row when the write omits it', async () => {
    const existingRow = { integrationId: 'default_on', isEnabled: false, reauthRequired: false, enabledAt: null }
    const { em, service } = createService(existingRow)

    const updated = await service.upsert('default_on', { reauthRequired: true }, scope)

    expect(em.create).not.toHaveBeenCalled()
    expect(updated.isEnabled).toBe(false)
    expect(updated.reauthRequired).toBe(true)
    expect(updated.enabledAt).toBeNull()
  })
})
