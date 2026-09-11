export {}

const registerCommand = jest.fn()
const setCustomFieldsIfAny = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrl: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    setCustomFieldsIfAny,
  }
})

import type { AwilixContainer } from 'awilix'
import { createCatalogCategoriesWithProgress } from '../../lib/bulkCreateCategories'
import type { CategoryBulkCreateRow } from '../../data/validators'

const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'

type CreateCommand = { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<{ categoryId: string }> }

function loadCreateCommand(): CreateCommand {
  let command: unknown
  jest.isolateModules(() => {
    require('../categories')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.categories.create')?.[0]
  })
  if (!command) throw new Error('catalog.categories.create command not registered')
  return command as CreateCommand
}

function buildEm() {
  let idCounter = 0
  const em: Record<string, unknown> = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: `category-${++idCounter}`,
      ...payload,
    })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  }
  ;(em as Record<string, unknown>).fork = jest.fn().mockReturnValue(em)
  return em
}

function row(name: string): CategoryBulkCreateRow {
  return { name } as CategoryBulkCreateRow
}

describe('bulk-created categories still emit the command\'s normal CRUD side effects per row', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('calls dataEngine.markOrmEntityChange once per row with the unchanged create-event wiring', async () => {
    const createCommand = loadCreateCommand()
    const em = buildEm()
    const markOrmEntityChange = jest.fn().mockResolvedValue(undefined)
    const dataEngine = { markOrmEntityChange }

    const commandBus = {
      execute: jest.fn().mockImplementation(async (id: string, { input, ctx }: { input: Record<string, unknown>; ctx: unknown }) => {
        if (id !== 'catalog.categories.create') throw new Error(`unexpected command ${id}`)
        const result = await createCommand.execute(input, ctx)
        return { result }
      }),
    }

    const progressService = {
      getJob: jest.fn().mockResolvedValue({ meta: null }),
      startJob: jest.fn().mockResolvedValue(undefined),
      updateProgress: jest.fn().mockResolvedValue(undefined),
      isCancellationRequested: jest.fn().mockResolvedValue(false),
      markCancelled: jest.fn().mockResolvedValue(undefined),
      completeJob: jest.fn().mockResolvedValue(undefined),
    }

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return commandBus
        if (name === 'progressService') return progressService
        if (name === 'em') return em
        if (name === 'dataEngine') return dataEngine
        return undefined
      }),
    } as unknown as AwilixContainer

    const items: CategoryBulkCreateRow[] = [row('Alpha'), row('Beta'), row('Gamma')]

    const summary = await createCatalogCategoriesWithProgress({
      container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT, userId: 'user-1' },
    })

    expect(summary.createdCount).toBe(items.length)
    expect(summary.failedCount).toBe(0)

    // One emitCrudSideEffects -> dataEngine.markOrmEntityChange call per row, same as a single
    // (non-bulk) POST to the category create command would produce — the bulk worker calls the
    // unchanged command once per row and never batches or suppresses its side effects.
    expect(markOrmEntityChange).toHaveBeenCalledTimes(items.length)

    const calls = markOrmEntityChange.mock.calls.map(([opts]) => opts as {
      action: string
      identifiers: { id: string; organizationId: string; tenantId: string }
      events?: { module: string; entity: string; persistent: boolean }
      indexer?: unknown
    })

    expect(calls.every((call) => call.action === 'created')).toBe(true)
    expect(calls.every((call) => call.identifiers.organizationId === ORG && call.identifiers.tenantId === TENANT)).toBe(true)
    // Each row's command invocation produced its own record — one distinct emitted id per row,
    // not one shared/collapsed emission for the whole batch.
    expect(new Set(calls.map((call) => call.identifiers.id)).size).toBe(items.length)

    // Every call carries the exact same `events` config object reference — it's the command's own
    // module-level `categoryCrudEvents` constant, not something the bulk path rebuilds or alters
    // per call.
    const [firstEvents, ...restEvents] = calls.map((call) => call.events)
    expect(firstEvents).toMatchObject({ module: 'catalog', entity: 'category', persistent: true })
    expect(restEvents.every((events) => events === firstEvents)).toBe(true)

    // `catalog.categories.create` does not pass an `indexer` config to emitCrudSideEffects today
    // (verified by reading commands/categories.ts) — categories are not wired into query-index
    // writes via this command, in bulk or otherwise. Documented here rather than asserting an
    // indexer call that would never have existed even for a single non-bulk create.
    expect(calls.every((call) => call.indexer === undefined)).toBe(true)
  })
})
