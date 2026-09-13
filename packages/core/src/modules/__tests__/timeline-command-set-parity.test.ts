/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../customers/commands'
import '../staff/commands'
import '../resources/commands'
import '../sales/commands'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

// Phase 0 of the timeline command-set factory extraction (spec
// `.ai/specs/2026-08-28-timeline-command-set-factories.md`, issue #3624).
//
// Characterization tests, not behavior tests: undo replays `logEntry` snapshots that
// already exist in customer databases, so a renamed command id, audit label or resource
// kind silently breaks undo for every action already recorded. These must keep passing
// unchanged through Phases 1-4 — a diff here means the refactor broke a persisted
// contract, not that the test went stale.

type Family = 'comments' | 'activities' | 'addresses' | 'notes'

// The persisted snapshot envelope is NOT uniform across families: comments, addresses and
// notes store a flat record, while activities nest theirs under `activity` and carry an
// optional `custom` sibling for custom-field values. Both shapes are already written to
// `action_logs`, so the factory must reproduce each family's own envelope rather than
// normalizing them to one.
type SnapshotEnvelope = 'flat' | 'activity'

type TimelineCommandSet = {
  family: Family
  module: string
  prefix: string
  resourceKind: string
  deleteLabelKey: string
  envelope: SnapshotEnvelope
}

const TIMELINE_COMMAND_SETS: TimelineCommandSet[] = [
  {
    family: 'comments',
    module: 'customers',
    prefix: 'customers.comments',
    resourceKind: 'customers.comment',
    deleteLabelKey: 'customers.audit.comments.delete',
    envelope: 'flat',
  },
  {
    family: 'comments',
    module: 'staff',
    prefix: 'staff.team-member-comments',
    resourceKind: 'staff.team_member_comment',
    deleteLabelKey: 'staff.audit.teamMemberComments.delete',
    envelope: 'flat',
  },
  {
    family: 'comments',
    module: 'resources',
    prefix: 'resources.resource-comments',
    resourceKind: 'resources.resource_comment',
    deleteLabelKey: 'resources.audit.resourceComments.delete',
    envelope: 'flat',
  },
  {
    family: 'activities',
    module: 'staff',
    prefix: 'staff.team-member-activities',
    resourceKind: 'staff.team_member_activity',
    deleteLabelKey: 'staff.audit.teamMemberActivities.delete',
    envelope: 'activity',
  },
  {
    family: 'activities',
    module: 'resources',
    prefix: 'resources.resource-activities',
    resourceKind: 'resources.resource_activity',
    deleteLabelKey: 'resources.audit.resourceActivities.delete',
    envelope: 'activity',
  },
  {
    family: 'addresses',
    module: 'customers',
    prefix: 'customers.addresses',
    resourceKind: 'customers.address',
    deleteLabelKey: 'customers.audit.addresses.delete',
    envelope: 'flat',
  },
  {
    family: 'addresses',
    module: 'staff',
    prefix: 'staff.team-member-addresses',
    resourceKind: 'staff.team_member_address',
    deleteLabelKey: 'staff.audit.teamMemberAddresses.delete',
    envelope: 'flat',
  },
  {
    family: 'notes',
    module: 'sales',
    prefix: 'sales.notes',
    resourceKind: 'sales.note',
    deleteLabelKey: 'sales.audit.notes.delete',
    envelope: 'flat',
  },
]

const VERBS = ['create', 'update', 'delete'] as const

const ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_ID = '44444444-4444-4444-8444-444444444444'

function makeBeforeSnapshot(envelope: SnapshotEnvelope): Record<string, unknown> {
  const row = {
    id: ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    // Parent keys differ per module; supplying both keeps the fixture family-agnostic
    // without asserting on either, since parent resolution is out of scope for Phase 0.
    memberId: PARENT_ID,
    resourceId: PARENT_ID,
  }
  return envelope === 'activity' ? { activity: row } : row
}

async function buildDeleteLog(set: TimelineCommandSet) {
  const handler = commandRegistry.get(`${set.prefix}.delete`)
  const before = makeBeforeSnapshot(set.envelope)
  const log = await handler?.buildLog?.({
    input: {},
    result: { id: ID },
    snapshots: { before },
    ctx: {},
  } as never)
  return { before, log }
}

describe('timeline command-set parity (#3624 Phase 0)', () => {
  it('registers exactly the 24 timeline command ids the extraction must preserve', () => {
    const expected = TIMELINE_COMMAND_SETS.flatMap((set) => VERBS.map((verb) => `${set.prefix}.${verb}`)).sort()
    const registered = commandRegistry.list()

    expect(expected.filter((id) => !registered.includes(id))).toEqual([])
    expect(expected).toHaveLength(24)
  })

  describe.each(TIMELINE_COMMAND_SETS)('$module $family ($prefix)', (set) => {
    // `makeCreateRedo` adoption is currently partial — comments and notes use it,
    // activities and addresses hand-roll the equivalent. Standardizing on it during the
    // extraction must leave this observable shape identical.
    it.each(VERBS)('%s keeps its undoable handler shape', (verb) => {
      const handler = commandRegistry.get(`${set.prefix}.${verb}`)

      expect(handler).not.toBeNull()
      expect(typeof handler?.buildLog).toBe('function')
      expect(typeof handler?.undo).toBe('function')
      expect(typeof handler?.redo).toBe(verb === 'create' ? 'function' : 'undefined')
    })

    it('delete emits the persisted audit label and resource kind unchanged', async () => {
      const { log } = await buildDeleteLog(set)

      expect(log).toBeTruthy()
      expect(log?.actionLabel).toBe(set.deleteLabelKey)
      expect(log?.resourceKind).toBe(set.resourceKind)
      expect(log?.resourceId).toBe(ID)
      expect(log?.tenantId).toBe(TENANT_ID)
      expect(log?.organizationId).toBe(ORGANIZATION_ID)
    })

    it('delete carries the before snapshot in the undo payload', async () => {
      const { before, log } = await buildDeleteLog(set)

      // `payload.undo.before` is the shape `extractUndoPayload` reads back from rows that
      // already exist in customer databases. Renaming either key — or flattening the
      // activities envelope — breaks historical undo.
      expect((log?.payload as { undo?: { before?: unknown } } | undefined)?.undo?.before).toEqual(before)
      expect(log?.snapshotBefore).toEqual(before)
    })
  })
})
