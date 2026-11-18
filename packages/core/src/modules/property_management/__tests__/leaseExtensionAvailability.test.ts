/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  Building,
  Lease,
  LeaseProposal,
  LeaseVersion,
  PropertyManagementSettings,
  SalesOperation,
  Unavailability,
  Unit,
} from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined) }))
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null) }
})
jest.mock('../lib/salesOperations', () => {
  const actual = jest.requireActual('../lib/salesOperations')
  return { ...actual, enqueueSalesOperations: jest.fn(async () => undefined) }
})
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})

import '../commands'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '60000000-0000-4000-8000-000000000001'
const FLOOR = '60000000-0000-4000-8000-000000000002'
const SPACE = '60000000-0000-4000-8000-000000000003'
const UNIT = '60000000-0000-4000-8000-000000000004'
const LEASE = '60000000-0000-4000-8000-000000000005'
const VERSION = '60000000-0000-4000-8000-000000000006'
const PRODUCT = '60000000-0000-4000-8000-000000000007'
const COMPANY = '60000000-0000-4000-8000-000000000008'
const CHANNEL = '60000000-0000-4000-8000-000000000009'

function seed(): FakeEm {
  const em = new FakeEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Unit, { id: UNIT, ...scope, buildingId: BUILDING, floorId: FLOOR, spaceId: SPACE, name: 'Studio 2B', catalogProductId: PRODUCT, deletedAt: null } as never)
  em.seed(Lease, {
    id: LEASE,
    ...scope,
    reference: 'L-2030-001',
    buildingId: BUILDING,
    unitId: UNIT,
    customerCompanyId: COMPANY,
    primaryContactPersonId: null,
    status: 'active',
    startsOn: '2030-01-01',
    termMonths: 2,
    endsOn: '2030-02-28',
    currentVersionId: VERSION,
    holdToken: null,
    pendingChange: null,
    deletedAt: null,
  } as never)
  em.seed(LeaseVersion, {
    id: VERSION,
    ...scope,
    leaseId: LEASE,
    versionNo: 1,
    event: 'activated',
    state: 'active',
    catalogProductId: PRODUCT,
    productName: 'Private office',
    monthlyRate: '1200.0000',
    currencyCode: 'PLN',
    startsOn: '2030-01-01',
    endsOn: '2030-02-28',
    months: 2,
    holdToken: null,
    effectiveFrom: '2030-01-01',
  } as never)
  em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, billingChannelId: CHANNEL, proposalExpiryDays: 14 } as never)
  return em
}

function closeFloor(em: FakeEm, startsAt: string, endsAt: string): void {
  em.seed(Unavailability, {
    id: 'closure-1',
    ...scope,
    buildingId: BUILDING,
    subjectType: 'floor',
    subjectId: FLOOR,
    reasonText: 'Works',
    startsAt,
    endsAt,
    endedAt: null,
    deletedAt: null,
  } as never)
}

function buildCtx(em: FakeEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

async function extend(em: FakeEm, commandId: string): Promise<{ versionId: string }> {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] missing ${commandId}`)
  return handler.execute({ ...scope, id: LEASE, months: 3, monthlyRate: 1200 }, buildCtx(em)) as Promise<{ versionId: string }>
}

async function expectUnavailable(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(422)
    expect((err as CrudHttpError).body).toMatchObject({ code: 'unit_unavailable' })
    return
  }
  throw new Error('[internal] expected the command to fail')
}

const COMMANDS = ['property_management.lease.extend', 'property_management.lease.propose_extension']

beforeEach(() => jest.clearAllMocks())

describe('lease extension unit availability', () => {
  it.each(COMMANDS)('%s refuses an extension whose window overlaps a floor closure', async (commandId) => {
    const em = seed()
    closeFloor(em, '2030-03-15T00:00:00', '2030-04-30T00:00:00')
    await expectUnavailable(extend(em, commandId))
    expect(em.rows(LeaseVersion)).toHaveLength(1)
    expect(em.rows(LeaseProposal)).toHaveLength(0)
    expect(em.rows(SalesOperation)).toHaveLength(0)
  })

  it.each(COMMANDS)('%s admits an extension when the closure lies outside its window', async (commandId) => {
    const em = seed()
    closeFloor(em, '2030-07-01T00:00:00', '2030-08-01T00:00:00')
    const result = await extend(em, commandId)
    const created = em.rows(LeaseVersion).find((row) => row.id === result.versionId)
    expect(created).toMatchObject({ event: 'extended', startsOn: '2030-03-01', endsOn: '2030-05-31' })
    expect(em.rows(SalesOperation)).toHaveLength(1)
  })

  it('admits an extension when the closure ends before the extension starts', async () => {
    const em = seed()
    closeFloor(em, '2030-02-01T00:00:00', '2030-03-01T00:00:00')
    const result = await extend(em, 'property_management.lease.extend')
    expect(em.rows(LeaseVersion).some((row) => row.id === result.versionId)).toBe(true)
  })
})
