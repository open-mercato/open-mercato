/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../sales/commands'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

// Phase 4 characterization net for the sales-notes family (#3624, spec
// `.ai/specs/2026-08-28-timeline-command-set-factories.md`).
//
// Adversarial by construction, per the three earlier lessons: fixtures move the fields a
// hook might read from the wrong snapshot, handler wiring is asserted rather than assumed,
// and every field list here was taken from a full-block read of `notes.ts` rather than a
// bounded grep window (the Phase 3 reporting error).
//
// Notes are the only family with a per-row parent kind (`sales.<contextType>`), a
// polymorphic context across four document kinds, and denormalized `orderId`/`quoteId`
// alongside the context reference.

const PREFIX = 'sales.notes'
const RESOURCE_KIND = 'sales.note'
const LABELS = {
  create: 'sales.audit.notes.create',
  update: 'sales.audit.notes.update',
  delete: 'sales.audit.notes.delete',
}
// Deliberately narrow: context/relation columns are NOT audited as changes.
const CHANGE_KEYS = ['body', 'authorUserId', 'appearanceIcon', 'appearanceColor']

const ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const CONTEXT_ID = '44444444-4444-4444-8444-444444444444'
const MOVED_CONTEXT_ID = '55555555-5555-4555-8555-555555555555'
const AUTHOR_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_AUTHOR_ID = '77777777-7777-4777-8777-777777777777'

type NoteSnap = Record<string, unknown>

function snapshotFor(overrides: NoteSnap = {}): NoteSnap {
  return {
    id: ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    contextType: 'order',
    contextId: CONTEXT_ID,
    orderId: CONTEXT_ID,
    quoteId: null,
    body: 'Note body',
    authorUserId: AUTHOR_ID,
    appearanceIcon: null,
    appearanceColor: null,
    ...overrides,
  }
}

async function buildLogFor(verb: 'create' | 'update' | 'delete', snapshots: Record<string, unknown>) {
  const handler = commandRegistry.get(`${PREFIX}.${verb}`)
  if (!handler?.buildLog) throw new Error(`${PREFIX}.${verb} has no buildLog`)
  return handler.buildLog({ input: {}, ctx: {}, result: { noteId: ID }, snapshots } as never)
}

describe('timeline sales notes parity (#3624 Phase 4)', () => {
  it('registers the 3 note command ids the extraction must preserve', () => {
    const expected = ['create', 'update', 'delete'].map((v) => `${PREFIX}.${v}`)
    const registered = commandRegistry.list()
    expect(expected.filter((id) => !registered.includes(id))).toEqual([])
  })

  it('wires prepare/captureAfter/buildLog/undo/redo as the audit pipeline needs', () => {
    const create = commandRegistry.get(`${PREFIX}.create`)
    const update = commandRegistry.get(`${PREFIX}.update`)
    const del = commandRegistry.get(`${PREFIX}.delete`)

    // create has no `prepare` — there is no prior state to snapshot.
    expect(create?.prepare).toBeUndefined()
    expect(typeof create?.captureAfter).toBe('function')
    expect(typeof create?.redo).toBe('function')
    expect(typeof create?.undo).toBe('function')

    expect(typeof update?.prepare).toBe('function')
    expect(typeof update?.captureAfter).toBe('function')
    expect(typeof update?.undo).toBe('function')
    expect(update?.redo).toBeUndefined()

    expect(typeof del?.prepare).toBe('function')
    // delete has no `captureAfter` — the row is gone by then.
    expect(del?.captureAfter).toBeUndefined()
    expect(typeof del?.undo).toBe('function')
    expect(del?.redo).toBeUndefined()

    for (const h of [create, update, del]) expect(typeof h?.buildLog).toBe('function')
  })

  it('create log derives the parent kind from the row\'s own context type', async () => {
    const after = snapshotFor()
    const log = await buildLogFor('create', { after })

    expect(log?.actionLabel).toBe(LABELS.create)
    expect(log?.resourceKind).toBe(RESOURCE_KIND)
    expect(log?.resourceId).toBe(ID)
    expect(log?.parentResourceKind).toBe('sales.order')
    expect(log?.parentResourceId).toBe(CONTEXT_ID)
    expect(log?.tenantId).toBe(TENANT_ID)
    expect(log?.organizationId).toBe(ORGANIZATION_ID)
    expect(log?.snapshotAfter).toEqual(after)
    expect((log?.payload as { undo?: { after?: unknown } })?.undo?.after).toEqual(after)
  })

  // The four kinds accepted by `noteCreateSchema` — `credit_memo` is snake_case on the wire.
  it.each(['order', 'quote', 'invoice', 'credit_memo'])(
    'create log renders the parent kind for context type %s',
    async (contextType) => {
      const after = snapshotFor({ contextType })
      const log = await buildLogFor('create', { after })
      expect(log?.parentResourceKind).toBe(`sales.${contextType}`)
    },
  )

  it('update log keeps both snapshots and reports a body change', async () => {
    const before = snapshotFor()
    const after = snapshotFor({ body: 'Edited body' })
    const log = await buildLogFor('update', { before, after })

    expect(log?.actionLabel).toBe(LABELS.update)
    expect(log?.snapshotBefore).toEqual(before)
    expect(log?.snapshotAfter).toEqual(after)
    const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
    expect(changes.body).toEqual({ from: 'Note body', to: 'Edited body' })
  })

  it('update log reports an author change', async () => {
    const before = snapshotFor()
    const after = snapshotFor({ authorUserId: OTHER_AUTHOR_ID })
    const log = await buildLogFor('update', { before, after })

    const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
    expect(changes.authorUserId).toEqual({ from: AUTHOR_ID, to: OTHER_AUTHOR_ID })
  })

  it('update log reports a nullable transition', async () => {
    const before = snapshotFor({ appearanceColor: null })
    const after = snapshotFor({ appearanceColor: '#ff0000' })
    const log = await buildLogFor('update', { before, after })

    const changes = (log?.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>
    expect(changes.appearanceColor).toEqual({ from: null, to: '#ff0000' })
  })

  // Context and relation columns are deliberately outside the audited change set.
  it('update log never audits context or denormalized relation columns', async () => {
    const before = snapshotFor()
    const after = snapshotFor({ contextType: 'quote', contextId: MOVED_CONTEXT_ID, orderId: null, quoteId: MOVED_CONTEXT_ID })
    const log = await buildLogFor('update', { before, after })

    const changes = (log?.changes ?? {}) as Record<string, unknown>
    expect(changes.contextType).toBeUndefined()
    expect(changes.contextId).toBeUndefined()
    expect(changes.orderId).toBeUndefined()
    expect(changes.quoteId).toBeUndefined()
    for (const key of Object.keys(changes)) expect(CHANGE_KEYS).toContain(key)
  })

  // Adversarial: the context actually moves, so a hook reading the wrong snapshot shows up.
  it('update log derives parent metadata from the before snapshot', async () => {
    const before = snapshotFor()
    const after = snapshotFor({ contextType: 'quote', contextId: MOVED_CONTEXT_ID })
    const log = await buildLogFor('update', { before, after })

    expect(log?.parentResourceKind).toBe('sales.order')
    expect(log?.parentResourceId).toBe(CONTEXT_ID)
  })

  it('update log returns null without a before snapshot', async () => {
    expect(await buildLogFor('update', {})).toBeNull()
  })

  it('delete log carries only the before snapshot', async () => {
    const before = snapshotFor()
    const log = await buildLogFor('delete', { before })

    expect(log?.actionLabel).toBe(LABELS.delete)
    expect(log?.resourceId).toBe(ID)
    expect(log?.parentResourceKind).toBe('sales.order')
    expect(log?.snapshotBefore).toEqual(before)
    expect(log?.snapshotAfter ?? null).toBeNull()
    const undo = (log?.payload as { undo?: { before?: unknown; after?: unknown } })?.undo
    expect(undo?.before).toEqual(before)
    expect(undo?.after ?? null).toBeNull()
  })

  it('persists both denormalized relation ids in the undo snapshot', async () => {
    const before = snapshotFor({ orderId: null, quoteId: CONTEXT_ID, contextType: 'quote' })
    const log = await buildLogFor('delete', { before })
    const undoBefore = (log?.payload as { undo?: { before?: Record<string, unknown> } })?.undo?.before
    expect(undoBefore?.orderId).toBeNull()
    expect(undoBefore?.quoteId).toBe(CONTEXT_ID)
  })
})
