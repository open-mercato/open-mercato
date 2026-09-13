/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../staff/commands'
import '../resources/commands'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

// Phase 2 characterization net for the activities family (#3624, spec
// `.ai/specs/2026-08-28-timeline-command-set-factories.md`).
//
// Deliberately adversarial: the comments refactor introduced a before/after audit
// asymmetry that body-only fixtures could not detect, so every fixture here moves a
// field that the log metadata or `changes` contract might read from the wrong snapshot —
// the parent id, the author, custom fields and nullables.
//
// Activities persist a NESTED snapshot (`{ activity: {...}, custom?: {...} }`), unlike the
// flat comment/address/note shape. Written before the migration; must keep passing after.

type ActivitySet = {
  module: string
  prefix: string
  resourceKind: string
  parentResourceKind: string
  parentIdField: 'memberId' | 'resourceId'
  labels: { create: string; update: string; delete: string }
  changeKeys: readonly string[]
  /** `resources` re-loads the snapshot inside buildLog instead of reading `snapshots`. */
  buildLogReloads: boolean
}

const ACTIVITY_SETS: ActivitySet[] = [
  {
    module: 'staff',
    prefix: 'staff.team-member-activities',
    resourceKind: 'staff.team_member_activity',
    parentResourceKind: 'staff.teamMember',
    parentIdField: 'memberId',
    labels: {
      create: 'staff.audit.teamMemberActivities.create',
      update: 'staff.audit.teamMemberActivities.update',
      delete: 'staff.audit.teamMemberActivities.delete',
    },
    changeKeys: ['memberId', 'activityType', 'subject', 'body', 'occurredAt', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
    buildLogReloads: false,
  },
  {
    module: 'resources',
    prefix: 'resources.resource-activities',
    resourceKind: 'resources.resource_activity',
    parentResourceKind: 'resources.resource',
    parentIdField: 'resourceId',
    labels: {
      create: 'resources.audit.resourceActivities.create',
      update: 'resources.audit.resourceActivities.update',
      delete: 'resources.audit.resourceActivities.delete',
    },
    changeKeys: ['resourceId', 'activityType', 'subject', 'body', 'occurredAt', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
    buildLogReloads: true,
  },
]

const ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_ID = '44444444-4444-4444-8444-444444444444'
const MOVED_PARENT_ID = '55555555-5555-4555-8555-555555555555'
const AUTHOR_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_AUTHOR_ID = '77777777-7777-4777-8777-777777777777'

type Snap = { activity: Record<string, unknown>; custom?: Record<string, unknown> }

function snapshotFor(set: ActivitySet, activityOverrides: Record<string, unknown> = {}, custom?: Record<string, unknown>): Snap {
  return {
    activity: {
      id: ID,
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      [set.parentIdField]: PARENT_ID,
      activityType: 'call',
      subject: 'Subject',
      body: null,
      occurredAt: null,
      authorUserId: AUTHOR_ID,
      appearanceIcon: null,
      appearanceColor: null,
      ...activityOverrides,
    },
    ...(custom !== undefined ? { custom } : {}),
  }
}

/** Satisfies the modules whose buildLog still re-loads through the container. */
function ctxFor(set: ActivitySet, snapshot: Snap) {
  if (!set.buildLogReloads) return {}
  const a = snapshot.activity
  const row = {
    id: a.id,
    organizationId: a.organizationId,
    tenantId: a.tenantId,
    resource: { id: a[set.parentIdField] },
    activityType: a.activityType,
    subject: a.subject,
    body: a.body,
    occurredAt: a.occurredAt,
    authorUserId: a.authorUserId,
    appearanceIcon: a.appearanceIcon,
    appearanceColor: a.appearanceColor,
  }
  const em: Record<string, unknown> = { findOne: async () => row }
  em.fork = () => em
  return { container: { resolve: () => em } }
}

async function buildLogFor(set: ActivitySet, verb: 'create' | 'update' | 'delete', snapshots: Record<string, unknown>) {
  const handler = commandRegistry.get(`${set.prefix}.${verb}`)
  if (!handler?.buildLog) throw new Error(`${set.prefix}.${verb} has no buildLog`)
  const reference = (snapshots.after ?? snapshots.before ?? { activity: {} }) as Snap
  return handler.buildLog({
    input: {},
    ctx: ctxFor(set, reference),
    result: { activityId: ID },
    snapshots,
  } as never)
}

describe('timeline activities parity (#3624 Phase 2)', () => {
  it('registers the 6 activity command ids the extraction must preserve', () => {
    const expected = ACTIVITY_SETS.flatMap((s) => ['create', 'update', 'delete'].map((v) => `${s.prefix}.${v}`))
    const registered = commandRegistry.list()
    expect(expected.filter((id) => !registered.includes(id))).toEqual([])
    expect(expected).toHaveLength(6)
  })

  describe.each(ACTIVITY_SETS)('$module ($prefix)', (set) => {
    it('keeps the undoable handler shape (redo on create only)', () => {
      for (const verb of ['create', 'update', 'delete'] as const) {
        const handler = commandRegistry.get(`${set.prefix}.${verb}`)
        expect(typeof handler?.buildLog).toBe('function')
        expect(typeof handler?.undo).toBe('function')
        expect(typeof handler?.redo).toBe(verb === 'create' ? 'function' : 'undefined')
      }
    })

    it('create log reads identity and scope from the nested activity envelope', async () => {
      const after = snapshotFor(set)
      const log = await buildLogFor(set, 'create', { after })

      expect(log?.actionLabel).toBe(set.labels.create)
      expect(log?.resourceKind).toBe(set.resourceKind)
      expect(log?.resourceId).toBe(ID)
      expect(log?.parentResourceKind).toBe(set.parentResourceKind)
      expect(log?.parentResourceId).toBe(PARENT_ID)
      expect(log?.tenantId).toBe(TENANT_ID)
      expect(log?.organizationId).toBe(ORGANIZATION_ID)
      expect(log?.snapshotAfter).toEqual(after)
      expect((log?.payload as { undo?: { after?: unknown } })?.undo?.after).toEqual(after)
    })

    it('update log keeps both nested snapshots and the declared change keys', async () => {
      const before = snapshotFor(set)
      const after = snapshotFor(set, { subject: 'Edited subject' })
      const log = await buildLogFor(set, 'update', { before, after })

      expect(log?.actionLabel).toBe(set.labels.update)
      expect(log?.snapshotBefore).toEqual(before)
      expect(log?.snapshotAfter).toEqual(after)

      const changes = (log?.changes ?? {}) as Record<string, unknown>
      expect(Object.keys(changes)).toEqual(expect.arrayContaining(['subject']))
      // Only declared activity keys (plus the `custom` sibling) may ever appear.
      for (const key of Object.keys(changes)) {
        if (key === 'custom') continue
        expect(set.changeKeys).toContain(key)
      }
    })

    // Adversarial: the parent actually moves, so a hook reading the wrong snapshot shows up.
    it('update log derives parent metadata from the before snapshot', async () => {
      const before = snapshotFor(set)
      const after = snapshotFor(set, { [set.parentIdField]: MOVED_PARENT_ID })
      const log = await buildLogFor(set, 'update', { before, after })

      expect(log?.parentResourceId).toBe(PARENT_ID)
      expect(log?.parentResourceId).not.toBe(MOVED_PARENT_ID)
      expect(log?.tenantId).toBe(TENANT_ID)
    })

    it('update log reports an author change through the activity envelope', async () => {
      const before = snapshotFor(set)
      const after = snapshotFor(set, { authorUserId: OTHER_AUTHOR_ID })
      const log = await buildLogFor(set, 'update', { before, after })

      const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
      expect(changes.authorUserId).toEqual({ from: AUTHOR_ID, to: OTHER_AUTHOR_ID })
    })

    it('update log reports a nullable transition', async () => {
      const before = snapshotFor(set, { body: 'Original body' })
      const after = snapshotFor(set, { body: null })
      const log = await buildLogFor(set, 'update', { before, after })

      const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
      expect(changes.body).toEqual({ from: 'Original body', to: null })
    })

    it('update log adds a custom-field diff only when custom values actually change', async () => {
      const unchanged = await buildLogFor(set, 'update', {
        before: snapshotFor(set, {}, { cf_priority: 'high' }),
        after: snapshotFor(set, { subject: 'x' }, { cf_priority: 'high' }),
      })
      expect((unchanged?.changes as Record<string, unknown>)?.custom).toBeUndefined()

      const changed = await buildLogFor(set, 'update', {
        before: snapshotFor(set, {}, { cf_priority: 'high' }),
        after: snapshotFor(set, {}, { cf_priority: 'low' }),
      })
      expect((changed?.changes as Record<string, unknown>)?.custom).toBeDefined()
    })

    it('update log returns null without a before snapshot', async () => {
      expect(await buildLogFor(set, 'update', {})).toBeNull()
    })

    it('delete log carries only the before snapshot', async () => {
      const before = snapshotFor(set)
      const log = await buildLogFor(set, 'delete', { before })

      expect(log?.actionLabel).toBe(set.labels.delete)
      expect(log?.resourceId).toBe(ID)
      expect(log?.snapshotBefore).toEqual(before)
      expect(log?.snapshotAfter ?? null).toBeNull()
      const undo = (log?.payload as { undo?: { before?: unknown; after?: unknown } })?.undo
      expect(undo?.before).toEqual(before)
      expect(undo?.after ?? null).toBeNull()
    })
  })
})
