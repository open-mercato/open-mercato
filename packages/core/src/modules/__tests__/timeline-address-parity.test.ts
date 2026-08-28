/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../customers/commands'
import '../staff/commands'

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown>) => {
    for (const phase of phases) await phase()
  },
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

// Phase 3 characterization net for the addresses family (#3624, spec
// `.ai/specs/2026-08-28-timeline-command-set-factories.md`).
//
// Adversarial by construction, following the two earlier lessons: Phase 1 shipped a
// before/after asymmetry that body-only fixtures missed, and Phase 2 found a `captureAfter`
// that a handler silently lacked. So every fixture here MOVES a field a hook might read
// from the wrong snapshot, and the handler wiring itself is asserted rather than assumed.
//
// Addresses have no author and no custom fields, but they carry a primary-address
// invariant and the widest `changeKeys` list of any family (15 keys).

type AddressSet = {
  module: string
  prefix: string
  resourceKind: string
  parentIdField: 'entityId' | 'memberId'
  labels: { create: string; update: string; delete: string }
  changeKeys: readonly string[]
}

const ADDRESS_SETS: AddressSet[] = [
  {
    module: 'customers',
    prefix: 'customers.addresses',
    resourceKind: 'customers.address',
    parentIdField: 'entityId',
    labels: {
      create: 'customers.audit.addresses.create',
      update: 'customers.audit.addresses.update',
      delete: 'customers.audit.addresses.delete',
    },
    changeKeys: ['entityId', 'name', 'purpose', 'companyName', 'addressLine1', 'addressLine2', 'buildingNumber', 'flatNumber', 'city', 'region', 'postalCode', 'country', 'latitude', 'longitude', 'isPrimary'],
  },
  {
    module: 'staff',
    prefix: 'staff.team-member-addresses',
    resourceKind: 'staff.team_member_address',
    parentIdField: 'memberId',
    labels: {
      create: 'staff.audit.teamMemberAddresses.create',
      update: 'staff.audit.teamMemberAddresses.update',
      delete: 'staff.audit.teamMemberAddresses.delete',
    },
    changeKeys: ['memberId', 'name', 'purpose', 'companyName', 'addressLine1', 'addressLine2', 'buildingNumber', 'flatNumber', 'city', 'region', 'postalCode', 'country', 'latitude', 'longitude', 'isPrimary'],
  },
]

const ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_ID = '44444444-4444-4444-8444-444444444444'
const MOVED_PARENT_ID = '55555555-5555-4555-8555-555555555555'

function snapshotFor(set: AddressSet, overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    id: ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    [set.parentIdField]: PARENT_ID,
    name: 'HQ',
    purpose: 'billing',
    companyName: 'Acme sp. z o.o.',
    addressLine1: 'Wyspa Slodowa 7',
    addressLine2: null,
    buildingNumber: '7',
    flatNumber: null,
    city: 'Wroclaw',
    region: null,
    postalCode: '50-266',
    country: 'PL',
    latitude: null,
    longitude: null,
    isPrimary: false,
  }
  // Only customers persists the linked-entity kind, which drives its parent resource kind.
  if (set.module === 'customers') base.entityKind = 'person'
  return { ...base, ...overrides }
}

async function buildLogFor(set: AddressSet, verb: 'create' | 'update' | 'delete', snapshots: Record<string, unknown>) {
  const handler = commandRegistry.get(`${set.prefix}.${verb}`)
  if (!handler?.buildLog) throw new Error(`${set.prefix}.${verb} has no buildLog`)
  return handler.buildLog({ input: {}, ctx: {}, result: { addressId: ID }, snapshots } as never)
}

describe('timeline addresses parity (#3624 Phase 3)', () => {
  it('registers the 6 address command ids the extraction must preserve', () => {
    const expected = ADDRESS_SETS.flatMap((s) => ['create', 'update', 'delete'].map((v) => `${s.prefix}.${v}`))
    const registered = commandRegistry.list()
    expect(expected.filter((id) => !registered.includes(id))).toEqual([])
    expect(expected).toHaveLength(6)
  })

  describe.each(ADDRESS_SETS)('$module ($prefix)', (set) => {
    // Wiring, not behavior: Phase 2 showed a handler can silently lack `captureAfter`,
    // which empties `changes` and `snapshotAfter` in the persisted log.
    it('wires prepare/captureAfter/buildLog/undo/redo as the audit pipeline needs', () => {
      const create = commandRegistry.get(`${set.prefix}.create`)
      const update = commandRegistry.get(`${set.prefix}.update`)
      const del = commandRegistry.get(`${set.prefix}.delete`)

      expect(typeof create?.captureAfter).toBe('function')
      expect(typeof create?.redo).toBe('function')
      expect(typeof create?.undo).toBe('function')

      expect(typeof update?.prepare).toBe('function')
      expect(typeof update?.captureAfter).toBe('function')
      expect(typeof update?.undo).toBe('function')
      expect(update?.redo).toBeUndefined()

      expect(typeof del?.prepare).toBe('function')
      expect(typeof del?.undo).toBe('function')
      expect(del?.redo).toBeUndefined()

      for (const h of [create, update, del]) expect(typeof h?.buildLog).toBe('function')
    })

    it('create log reads identity, parent and scope from the after snapshot', async () => {
      const after = snapshotFor(set)
      const log = await buildLogFor(set, 'create', { after })

      expect(log?.actionLabel).toBe(set.labels.create)
      expect(log?.resourceKind).toBe(set.resourceKind)
      expect(log?.resourceId).toBe(ID)
      expect(log?.parentResourceId).toBe(PARENT_ID)
      expect(typeof log?.parentResourceKind).toBe('string')
      expect(log?.tenantId).toBe(TENANT_ID)
      expect(log?.organizationId).toBe(ORGANIZATION_ID)
      expect(log?.snapshotAfter).toEqual(after)
      expect((log?.payload as { undo?: { after?: unknown } })?.undo?.after).toEqual(after)
    })

    it('update log keeps both snapshots and reports a companyName change', async () => {
      const before = snapshotFor(set)
      const after = snapshotFor(set, { companyName: 'Acme International' })
      const log = await buildLogFor(set, 'update', { before, after })

      expect(log?.actionLabel).toBe(set.labels.update)
      expect(log?.snapshotBefore).toEqual(before)
      expect(log?.snapshotAfter).toEqual(after)
      const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
      expect(changes.companyName).toEqual({ from: 'Acme sp. z o.o.', to: 'Acme International' })
    })

    it('update log reports a primary-address transition', async () => {
      const before = snapshotFor(set, { isPrimary: false })
      const after = snapshotFor(set, { isPrimary: true })
      const log = await buildLogFor(set, 'update', { before, after })

      const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
      expect(changes.isPrimary).toEqual({ from: false, to: true })
    })

    it('update log reports a nullable transition', async () => {
      const before = snapshotFor(set, { region: null })
      const after = snapshotFor(set, { region: 'Dolnoslaskie' })
      const log = await buildLogFor(set, 'update', { before, after })

      const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
      expect(changes.region).toEqual({ from: null, to: 'Dolnoslaskie' })
    })

    // Address lines ARE part of the declared key list, and only declared keys may appear.
    it('update log reports an address-line change and nothing undeclared', async () => {
      const before = snapshotFor(set, { addressLine1: 'Old street 1' })
      const after = snapshotFor(set, { addressLine1: 'New street 2' })
      const log = await buildLogFor(set, 'update', { before, after })

      const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
      expect(changes.addressLine1).toEqual({ from: 'Old street 1', to: 'New street 2' })
      for (const key of Object.keys(changes)) expect(set.changeKeys).toContain(key)
    })

    it('update log derives parent metadata from the before snapshot', async () => {
      const before = snapshotFor(set)
      const after = snapshotFor(set, { [set.parentIdField]: MOVED_PARENT_ID })
      const log = await buildLogFor(set, 'update', { before, after })

      expect(log?.parentResourceId).toBe(PARENT_ID)
      expect(log?.parentResourceId).not.toBe(MOVED_PARENT_ID)
    })

    it('update log returns null without a before snapshot', async () => {
      expect(await buildLogFor(set, 'update', {})).toBeNull()
    })

    it('delete log carries only the before snapshot', async () => {
      const before = snapshotFor(set, { isPrimary: true })
      const log = await buildLogFor(set, 'delete', { before })

      expect(log?.actionLabel).toBe(set.labels.delete)
      expect(log?.resourceId).toBe(ID)
      expect(log?.snapshotBefore).toEqual(before)
      expect(log?.snapshotAfter ?? null).toBeNull()
      const undo = (log?.payload as { undo?: { before?: unknown; after?: unknown } })?.undo
      expect(undo?.before).toEqual(before)
      expect(undo?.after ?? null).toBeNull()
    })

    // The persisted snapshot must carry companyName so undo can restore it — this is the
    // divergence #3624 sanctions folding (customers delete-undo dropped it).
    it('persists companyName in the undo snapshot', async () => {
      const before = snapshotFor(set)
      const log = await buildLogFor(set, 'delete', { before })
      const undoBefore = (log?.payload as { undo?: { before?: Record<string, unknown> } })?.undo?.before
      expect(undoBefore?.companyName).toBe('Acme sp. z o.o.')
    })
  })
})

// ── Restore-path coverage ───────────────────────────────────────────────────
// buildLog fixtures cannot reach the undo/redo writes, yet that is exactly where the
// #3624-sanctioned correction lives: customers delete-undo previously skipped
// `companyName` when the row still existed, while its create branch and update-undo both
// set it. These drive the real handlers against a fake EntityManager.

type FakeAddress = Record<string, unknown>

function buildRestoreCtx(existing: FakeAddress | null) {
  const created: FakeAddress[] = []
  const em: Record<string, unknown> = {
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeUpdate: jest.fn().mockResolvedValue(undefined),
    // Any parent lookup resolves; the address lookup returns the row under test.
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const name = (entity as { name?: string })?.name ?? ''
      if (name.includes('Address')) return existing
      return { id: (where?.id as string) ?? PARENT_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, kind: 'person' }
    }),
    create: jest.fn((_e: unknown, data: FakeAddress) => {
      created.push(data)
      return { ...data }
    }),
  }
  em.fork = () => em
  const ctx = {
    container: { resolve: (n: string) => (n === 'em' ? em : {}) },
    auth: { sub: 'u', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
  return { em, ctx, created }
}

function undoLogEntry(before: Record<string, unknown>) {
  return { resourceId: ID, payload: { undo: { before } } }
}

describe('timeline addresses restore paths (#3624 Phase 3)', () => {
  describe.each(ADDRESS_SETS)('$module ($prefix)', (set) => {
    it('delete-undo restores companyName onto an EXISTING row', async () => {
      const before = snapshotFor(set, { companyName: 'Restored Sp. z o.o.' })
      const existing: FakeAddress = { id: ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, companyName: 'STALE' }
      const { ctx } = buildRestoreCtx(existing)

      const handler = commandRegistry.get(`${set.prefix}.delete`)
      await handler?.undo?.({ logEntry: undoLogEntry(before), ctx } as never)

      expect(existing.companyName).toBe('Restored Sp. z o.o.')
    })

    it('delete-undo restores the address lines onto an EXISTING row', async () => {
      const before = snapshotFor(set, { addressLine1: 'Line one', addressLine2: 'Line two' })
      const existing: FakeAddress = { id: ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
      const { ctx } = buildRestoreCtx(existing)

      const handler = commandRegistry.get(`${set.prefix}.delete`)
      await handler?.undo?.({ logEntry: undoLogEntry(before), ctx } as never)

      expect(existing.addressLine1).toBe('Line one')
      expect(existing.addressLine2).toBe('Line two')
    })

    it('delete-undo recreates the row with the full snapshot when it is gone', async () => {
      const before = snapshotFor(set, { companyName: 'Recreated Ltd', addressLine1: 'Seed street' })
      const { ctx, created } = buildRestoreCtx(null)

      const handler = commandRegistry.get(`${set.prefix}.delete`)
      await handler?.undo?.({ logEntry: undoLogEntry(before), ctx } as never)

      expect(created).toHaveLength(1)
      expect(created[0].companyName).toBe('Recreated Ltd')
      expect(created[0].addressLine1).toBe('Seed street')
      expect(created[0].id).toBe(ID)
    })

    it('update-undo restores companyName and the address lines onto an existing row', async () => {
      const before = snapshotFor(set, { companyName: 'Prev Co', addressLine1: 'Prev street' })
      const existing: FakeAddress = { id: ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, companyName: 'STALE' }
      const { ctx } = buildRestoreCtx(existing)

      const handler = commandRegistry.get(`${set.prefix}.update`)
      await handler?.undo?.({ logEntry: undoLogEntry(before), ctx } as never)

      expect(existing.companyName).toBe('Prev Co')
      expect(existing.addressLine1).toBe('Prev street')
    })

    it('restore demotes sibling primaries only when the restored row is primary', async () => {
      for (const isPrimary of [true, false]) {
        const before = snapshotFor(set, { isPrimary })
        const existing: FakeAddress = { id: ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
        const { em, ctx } = buildRestoreCtx(existing)

        const handler = commandRegistry.get(`${set.prefix}.delete`)
        await handler?.undo?.({ logEntry: undoLogEntry(before), ctx } as never)

        expect((em.nativeUpdate as jest.Mock).mock.calls.length).toBe(isPrimary ? 1 : 0)
      }
    })
  })
})
