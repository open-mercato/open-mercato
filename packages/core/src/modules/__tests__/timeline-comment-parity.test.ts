/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../customers/commands'
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

// Phase 1 characterization net for the comments family (#3624, spec
// `.ai/specs/2026-08-28-timeline-command-set-factories.md`).
//
// Complements `timeline-command-set-parity.test.ts`, which covers all 8 families at the
// delete path only. This file pins create and update as well, because those are the
// handlers `makeCommentCommandSet` rewrites. Written BEFORE the migration so it
// characterizes existing behavior; it must keep passing after.

type CommentSet = {
  module: string
  prefix: string
  resourceKind: string
  labels: { create: string; update: string; delete: string }
  /** Keys `buildChanges` is called with — the audit `changes` contract. */
  changeKeys: string[]
  /** Snapshot fields this module's parent/related log metadata is derived from. */
  parentIdField: string
}

const COMMENT_SETS: CommentSet[] = [
  {
    module: 'customers',
    prefix: 'customers.comments',
    resourceKind: 'customers.comment',
    labels: {
      create: 'customers.audit.comments.create',
      update: 'customers.audit.comments.update',
      delete: 'customers.audit.comments.delete',
    },
    changeKeys: ['entityId', 'dealId', 'body', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
    parentIdField: 'entityId',
  },
  {
    module: 'staff',
    prefix: 'staff.team-member-comments',
    resourceKind: 'staff.team_member_comment',
    labels: {
      create: 'staff.audit.teamMemberComments.create',
      update: 'staff.audit.teamMemberComments.update',
      delete: 'staff.audit.teamMemberComments.delete',
    },
    changeKeys: ['body', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
    parentIdField: 'memberId',
  },
  {
    module: 'resources',
    prefix: 'resources.resource-comments',
    resourceKind: 'resources.resource_comment',
    labels: {
      create: 'resources.audit.resourceComments.create',
      update: 'resources.audit.resourceComments.update',
      delete: 'resources.audit.resourceComments.delete',
    },
    changeKeys: ['resourceId', 'body', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
    parentIdField: 'resourceId',
  },
]

const ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_ID = '44444444-4444-4444-8444-444444444444'
const AUTHOR_ID = '55555555-5555-4555-8555-555555555555'
const MOVED_PARENT_ID = '66666666-6666-4666-8666-666666666666'

/** Mirrors each module's own `load*Snapshot` output — shapes are not uniform. */
function snapshotFor(set: CommentSet, overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    id: ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    [set.parentIdField]: PARENT_ID,
    body: 'Body text',
    authorUserId: AUTHOR_ID,
    appearanceIcon: null,
    appearanceColor: null,
  }
  // Only customers persists the linked-entity kind and deal id in its snapshot.
  if (set.module === 'customers') {
    base.entityKind = 'person'
    base.dealId = null
  }
  return { ...base, ...overrides }
}

async function buildLogFor(
  set: CommentSet,
  verb: 'create' | 'update' | 'delete',
  snapshots: Record<string, unknown>,
) {
  const handler = commandRegistry.get(`${set.prefix}.${verb}`)
  if (!handler?.buildLog) throw new Error(`${set.prefix}.${verb} has no buildLog`)
  return handler.buildLog({
    input: {},
    ctx: {},
    result: { commentId: ID },
    snapshots,
  } as never)
}

describe('timeline comments parity (#3624 Phase 1)', () => {
  describe.each(COMMENT_SETS)('$module ($prefix)', (set) => {
    it('create log pins label, resource kind and after-snapshot payload', async () => {
      const after = snapshotFor(set)
      const log = await buildLogFor(set, 'create', { after })

      expect(log?.actionLabel).toBe(set.labels.create)
      expect(log?.resourceKind).toBe(set.resourceKind)
      expect(log?.resourceId).toBe(ID)
      expect(log?.snapshotAfter).toEqual(after)
      expect((log?.payload as { undo?: { after?: unknown } })?.undo?.after).toEqual(after)
    })

    it('update log pins label, both snapshots and the audit change key set', async () => {
      const before = snapshotFor(set)
      const after = snapshotFor(set, { body: 'Edited body' })
      const log = await buildLogFor(set, 'update', { before, after })

      expect(log?.actionLabel).toBe(set.labels.update)
      expect(log?.resourceKind).toBe(set.resourceKind)
      expect(log?.snapshotBefore).toEqual(before)
      expect(log?.snapshotAfter).toEqual(after)

      // `changes` is a persisted audit contract: only the declared keys may appear,
      // and a changed key must be reported.
      const changes = (log?.changes ?? {}) as Record<string, unknown>
      expect(Object.keys(changes)).toEqual(expect.arrayContaining(['body']))
      for (const key of Object.keys(changes)) expect(set.changeKeys).toContain(key)

      const undo = (log?.payload as { undo?: { before?: unknown; after?: unknown } })?.undo
      expect(undo?.before).toEqual(before)
      expect(undo?.after).toEqual(after)
    })

    // Regression: `resources` update originally had NO `captureAfter` and re-loaded the
    // snapshot inside buildLog to obtain `after`. Reading `snapshots.after` without also
    // providing `captureAfter` silently empties `changes` and `snapshotAfter` in the
    // persisted log — a fixture that passes `after` explicitly cannot detect it.
    it('update populates snapshots.after via captureAfter', () => {
      const handler = commandRegistry.get(`${set.prefix}.update`)
      expect(typeof handler?.captureAfter).toBe('function')
    })

    it('update log returns null without a before snapshot', async () => {
      const log = await buildLogFor(set, 'update', {})
      expect(log).toBeNull()
    })

    it('delete log carries only the before snapshot', async () => {
      const before = snapshotFor(set)
      const log = await buildLogFor(set, 'delete', { before })

      expect(log?.actionLabel).toBe(set.labels.delete)
      expect(log?.snapshotBefore).toEqual(before)
      expect(log?.snapshotAfter ?? null).toBeNull()
      const undo = (log?.payload as { undo?: { before?: unknown; after?: unknown } })?.undo
      expect(undo?.before).toEqual(before)
      expect(undo?.after ?? null).toBeNull()
    })

    // Regression: an earlier factory draft passed a single snapshot to the log-metadata
    // hook, which silently changed customers' update log — it derives `parentResource*`
    // from `before` but `relatedResource*` from `after ?? before`. Changing only `body`
    // in a fixture cannot detect that, so the parent must actually move here.
    it('update log derives parent metadata from the before snapshot', async () => {
      const before = snapshotFor(set)
      const after = snapshotFor(set, { [set.parentIdField]: MOVED_PARENT_ID })
      const log = await buildLogFor(set, 'update', { before, after })

      expect(log?.parentResourceId).toBe(PARENT_ID)
      expect(log?.parentResourceId).not.toBe(MOVED_PARENT_ID)
    })

    it('parent log metadata resolves from the module\'s own snapshot field', async () => {
      const before = snapshotFor(set)
      const log = await buildLogFor(set, 'delete', { before })
      expect(log?.parentResourceId).toBe(PARENT_ID)
      expect(typeof log?.parentResourceKind).toBe('string')
    })
  })
})
