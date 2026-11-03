import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import {
  getNotificationType,
  getNotificationTypes,
  registerNotificationTypes,
  syncNotificationTypes,
} from '../notification-type-registry'
import { deriveCategory } from '../derive-category'

function def(type: string, extra: Partial<NotificationTypeDefinition> = {}): NotificationTypeDefinition {
  return {
    type,
    module: 'test',
    titleKey: `${type}.title`,
    icon: 'bell',
    severity: 'info',
    actions: [],
    ...extra,
  }
}

describe('notification-type-registry', () => {
  beforeEach(() => {
    registerNotificationTypes([], { replace: true })
  })

  it('registers and looks up types by id', () => {
    registerNotificationTypes([def('a.one'), def('a.two')])
    expect(getNotificationTypes().map((t) => t.type).sort()).toEqual(['a.one', 'a.two'])
    expect(getNotificationType('a.one')?.titleKey).toBe('a.one.title')
    expect(getNotificationType('missing')).toBeUndefined()
  })

  it('replace clears prior entries', () => {
    registerNotificationTypes([def('a.one')])
    registerNotificationTypes([def('b.one')], { replace: true })
    expect(getNotificationTypes().map((t) => t.type)).toEqual(['b.one'])
  })

  it('re-registering the same id overwrites in place', () => {
    registerNotificationTypes([def('a.one', { labelKey: 'first' })])
    registerNotificationTypes([def('a.one', { labelKey: 'second' })])
    expect(getNotificationTypes()).toHaveLength(1)
    expect(getNotificationType('a.one')?.labelKey).toBe('second')
  })
})

type ExistingRow = {
  id: string
  label_key: string
  description_key: string | null
  category?: string | null
  silent?: boolean
  non_opt_out?: boolean
}

/**
 * Minimal kysely test double for `syncNotificationTypes` (mirrors the query_index
 * jobs.test.ts pattern): records inserted value-rows, updates (id + set payload),
 * and pruned ids, and replays a configurable `notification_types` SELECT result.
 */
function createFakeEm(existing: ExistingRow[]) {
  const recorded = {
    inserted: [] as Array<Record<string, unknown>>,
    insertUsedOnConflict: false,
    updated: [] as Array<{ id: unknown; set: Record<string, unknown> }>,
    deletedIds: [] as unknown[],
  }

  // Mirror what an already-synced row looks like (silent/non_opt_out false, category resolved
  // from the type id like `categoryFor` does) so rows that omit these columns don't read back
  // as `undefined` and register spurious drift.
  const selectRows = existing.map((row) => ({
    category: deriveCategory(row.id),
    silent: false,
    non_opt_out: false,
    ...row,
  }))
  const selectChain: any = {
    select: () => selectChain,
    where: () => selectChain,
    execute: async () => selectRows,
  }
  const insertChain: any = {
    values: (rows: Array<Record<string, unknown>>) => {
      recorded.inserted.push(...rows)
      return insertChain
    },
    onConflict: (cb: (oc: any) => unknown) => {
      recorded.insertUsedOnConflict = true
      try { cb({ column: () => ({ doNothing: () => ({}) }) }) } catch { /* builder shape only */ }
      return insertChain
    },
    execute: async () => undefined,
  }
  const makeUpdateChain = () => {
    const entry: { id: unknown; set: Record<string, unknown> } = { id: undefined, set: {} }
    const chain: any = {
      set: (obj: Record<string, unknown>) => { entry.set = obj; return chain },
      where: (col: string, _op: string, val: unknown) => { if (col === 'id') entry.id = val; return chain },
      execute: async () => { recorded.updated.push(entry) },
    }
    return chain
  }
  const makeDeleteChain = () => {
    const chain: any = {
      where: (col: string, op: string, val: unknown) => {
        if (col === 'id' && op === 'in' && Array.isArray(val)) recorded.deletedIds.push(...val)
        return chain
      },
      execute: async () => undefined,
    }
    return chain
  }

  const db: any = {
    selectFrom: () => selectChain,
    insertInto: () => insertChain,
    updateTable: () => makeUpdateChain(),
    deleteFrom: () => makeDeleteChain(),
  }
  const em = { getKysely: () => db }
  return { em, recorded }
}

describe('syncNotificationTypes (DB read-through mirror)', () => {
  beforeEach(() => {
    registerNotificationTypes([], { replace: true })
  })

  it('creates missing types via INSERT ... ON CONFLICT DO NOTHING', async () => {
    registerNotificationTypes([def('a.one', { labelKey: 'a.one.label' }), def('a.two')], { replace: true })
    const { em, recorded } = createFakeEm([])
    const res = await syncNotificationTypes(em as never, { force: true })

    expect(recorded.inserted.map((r) => r.id).sort()).toEqual(['a.one', 'a.two'])
    expect(recorded.inserted.find((r) => r.id === 'a.one')?.label_key).toBe('a.one.label')
    expect(recorded.insertUsedOnConflict).toBe(true)
    expect(recorded.updated).toHaveLength(0)
    expect(recorded.deletedIds).toHaveLength(0)
    expect(res).toMatchObject({ created: 2, updated: 0, deleted: 0 })
  })

  it('updates only drifted rows and leaves in-sync rows untouched', async () => {
    registerNotificationTypes(
      [def('a.one', { labelKey: 'new.label' }), def('a.two', { labelKey: 'same.label' })],
      { replace: true },
    )
    const { em, recorded } = createFakeEm([
      { id: 'a.one', label_key: 'old.label', description_key: null },
      { id: 'a.two', label_key: 'same.label', description_key: null },
    ])
    const res = await syncNotificationTypes(em as never, { force: true })

    expect(recorded.inserted).toHaveLength(0)
    expect(recorded.updated.map((u) => u.id)).toEqual(['a.one'])
    expect(recorded.updated[0]?.set.label_key).toBe('new.label')
    expect(recorded.deletedIds).toHaveLength(0)
    expect(res).toMatchObject({ created: 0, updated: 1, deleted: 0 })
  })

  it('prunes system-wide rows no longer in the catalogue', async () => {
    registerNotificationTypes([def('keep.one', { labelKey: 'keep.label' })], { replace: true })
    const { em, recorded } = createFakeEm([
      { id: 'keep.one', label_key: 'keep.label', description_key: null },
      { id: 'stale.one', label_key: 'x', description_key: null },
      { id: 'stale.two', label_key: 'y', description_key: null },
    ])
    const res = await syncNotificationTypes(em as never, { force: true })

    expect((recorded.deletedIds as string[]).sort()).toEqual(['stale.one', 'stale.two'])
    expect(recorded.deletedIds).not.toContain('keep.one')
    expect(res.deleted).toBe(2)
  })

  it('never prunes when the in-memory catalogue is empty (guard)', async () => {
    registerNotificationTypes([], { replace: true })
    const { em, recorded } = createFakeEm([{ id: 'orphan', label_key: 'x', description_key: null }])
    const res = await syncNotificationTypes(em as never, { force: true })

    expect(recorded.deletedIds).toHaveLength(0)
    expect(res.deleted).toBe(0)
  })

  it('mirrors category/silent/nonOptOut onto a newly inserted row', async () => {
    registerNotificationTypes(
      [def('a.secure', { category: 'security', silent: true, nonOptOut: true })],
      { replace: true },
    )
    const { em, recorded } = createFakeEm([])
    const res = await syncNotificationTypes(em as never, { force: true })

    expect(res.created).toBe(1)
    expect(recorded.inserted[0]).toMatchObject({
      id: 'a.secure',
      category: 'security',
      silent: true,
      non_opt_out: true,
    })
  })

  it('derives the category from the type id prefix when the definition declares none', async () => {
    registerNotificationTypes([def('sales.order.created')], { replace: true })
    const { em, recorded } = createFakeEm([])
    await syncNotificationTypes(em as never, { force: true })
    expect(recorded.inserted[0]).toMatchObject({ id: 'sales.order.created', category: 'sales' })
  })

  it('backfills the derived category onto a row stored before the default existed', async () => {
    registerNotificationTypes([def('sales.order.created')], { replace: true })
    const { em, recorded } = createFakeEm([
      { id: 'sales.order.created', label_key: 'sales.order.created.title', description_key: null, category: null },
    ])
    const res = await syncNotificationTypes(em as never, { force: true })
    expect(res.updated).toBe(1)
    expect(recorded.updated[0]?.set.category).toBe('sales')
  })

  it('does not mirror a hiddenFromSettings type to the catalogue', async () => {
    registerNotificationTypes([def('admin.custom_message', { hiddenFromSettings: true, nonOptOut: true })])
    const { em, recorded } = createFakeEm([])
    const result = await syncNotificationTypes(em as never, { force: true })
    expect(recorded.inserted).toHaveLength(0)
    expect(result.created).toBe(0)
  })

  it('drops a stale catalogue row when a type is flipped to hiddenFromSettings', async () => {
    registerNotificationTypes([def('admin.custom_message', { hiddenFromSettings: true })])
    const { em, recorded } = createFakeEm([{ id: 'admin.custom_message' }])
    const result = await syncNotificationTypes(em as never, { force: true })
    expect(recorded.deletedIds).toContain('admin.custom_message')
    expect(result.deleted).toBe(1)
  })

  it('updates an existing row when category/silent drift', async () => {
    registerNotificationTypes(
      [def('a.secure', { labelKey: 'a.secure.title', category: 'security', silent: true })],
      { replace: true },
    )
    const { em, recorded } = createFakeEm([
      {
        id: 'a.secure',
        label_key: 'a.secure.title',
        description_key: null,
        category: null,
        silent: false,
        non_opt_out: false,
      },
    ])
    const res = await syncNotificationTypes(em as never, { force: true })

    expect(res.updated).toBe(1)
    expect(recorded.inserted).toHaveLength(0)
    expect(recorded.updated[0]?.set).toMatchObject({ category: 'security', silent: true })
  })
})
