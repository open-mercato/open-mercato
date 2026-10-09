/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { metadata as enricherCacheProfileMetadata } from '../../subscribers/invalidate-enricher-cache-profile'
import { metadata as availabilityCacheProfileMetadata } from '../../subscribers/invalidate-availability-cache-profile'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown) =>
    emInstance.findOne(entity, filters),
}))

jest.mock('../../events', () => {
  const actual = jest.requireActual('../../events')
  return {
    ...actual,
    emitWmsEvent: jest.fn().mockResolvedValue(undefined),
  }
})

const TENANT = 'tenant-1'
const ORG = 'org-1'

function profileSnapshot() {
  return {
    id: 'profile-1',
    organizationId: ORG,
    tenantId: TENANT,
    catalogProductId: 'product-1',
    catalogVariantId: null,
    defaultUom: 'pcs',
    trackLot: false,
    trackSerial: false,
    trackExpiration: false,
    defaultStrategy: 'fifo',
    reorderPoint: '5',
    safetyStock: '2',
    metadata: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  }
}

function buildCtx(record: Record<string, unknown>) {
  return {
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    container: {
      resolve: (name: string) => {
        if (name === 'em') {
          return {
            fork: () => ({
              findOne: jest.fn(async (_entity: unknown, filters: any) => (filters?.id === record.id ? record : null)),
              flush: jest.fn(async () => undefined),
            }),
          }
        }
        throw new Error(`unexpected resolve: ${name}`)
      },
    },
  } as any
}

const expectedPayload = {
  id: 'profile-1',
  profileId: 'profile-1',
  catalogProductId: 'product-1',
  catalogVariantId: null,
  tenantId: TENANT,
  organizationId: ORG,
}

describe('WMS inventory profile events', () => {
  let emitWmsEvent: jest.Mock

  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../configuration')
    emitWmsEvent = (jest.requireMock('../../events') as { emitWmsEvent: jest.Mock }).emitWmsEvent
  })

  beforeEach(() => {
    emitWmsEvent.mockClear()
  })

  it('emits wms.inventory_profile.deleted when a profile is deleted, so cached enrichments stop serving it (#6142)', async () => {
    const record: Record<string, unknown> = { ...profileSnapshot(), deletedAt: null }
    const handler = commandRegistry.get('wms.inventoryProfiles.delete')!

    await handler.execute({ id: 'profile-1' }, buildCtx(record))

    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(emitWmsEvent).toHaveBeenCalledWith('wms.inventory_profile.deleted', expectedPayload)
  })

  it('routes the deleted event to the enricher and availability cache invalidation subscribers', () => {
    expect(matchEventPattern('wms.inventory_profile.deleted', enricherCacheProfileMetadata.event)).toBe(true)
    expect(matchEventPattern('wms.inventory_profile.deleted', availabilityCacheProfileMetadata.event)).toBe(true)
  })

  it('emits wms.inventory_profile.deleted when a profile create is undone', async () => {
    const after = profileSnapshot()
    const record: Record<string, unknown> = { ...after, deletedAt: null }
    const handler = commandRegistry.get('wms.inventoryProfiles.create')!

    await handler.undo!({
      input: {},
      logEntry: { commandPayload: { undo: { after } } } as any,
      ctx: buildCtx(record),
      undoToken: 'token-1',
    } as any)

    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(emitWmsEvent).toHaveBeenCalledWith('wms.inventory_profile.deleted', expectedPayload)
  })

  it('emits wms.inventory_profile.created when a profile delete is undone', async () => {
    const before = profileSnapshot()
    const record: Record<string, unknown> = { ...before, deletedAt: new Date() }
    const handler = commandRegistry.get('wms.inventoryProfiles.delete')!

    await handler.undo!({
      input: {},
      logEntry: { commandPayload: { undo: { before } } } as any,
      ctx: buildCtx(record),
      undoToken: 'token-1',
    } as any)

    expect(record.deletedAt).toBeNull()
    expect(emitWmsEvent).toHaveBeenCalledWith('wms.inventory_profile.created', expectedPayload)
  })

  it('emits wms.inventory_profile.updated when a profile update is undone', async () => {
    const before = profileSnapshot()
    const record: Record<string, unknown> = { ...before, defaultStrategy: 'lifo', deletedAt: null }
    const handler = commandRegistry.get('wms.inventoryProfiles.update')!

    await handler.undo!({
      input: {},
      logEntry: { commandPayload: { undo: { before, after: { ...before, defaultStrategy: 'lifo' } } } } as any,
      ctx: buildCtx(record),
      undoToken: 'token-1',
    } as any)

    expect(record.defaultStrategy).toBe('fifo')
    expect(emitWmsEvent).toHaveBeenCalledWith('wms.inventory_profile.updated', expectedPayload)
  })
})
