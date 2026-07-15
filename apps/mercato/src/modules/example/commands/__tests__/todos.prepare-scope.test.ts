jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn().mockResolvedValue({}),
  buildCustomFieldResetMap: jest.fn(() => ({})),
  diffCustomFieldChanges: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '../todos'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'

const TODO_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'

function getCommand(id: string): CommandHandler<unknown, unknown> {
  const handler = commandRegistry.get(id)
  if (!handler) throw new Error(`Command ${id} not registered`)
  return handler as CommandHandler<unknown, unknown>
}

function createCtx() {
  const findOne = jest.fn().mockResolvedValue({
    id: TODO_ID,
    title: 'Scoped todo',
    isDone: false,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
  })
  const em = { findOne } as unknown as EntityManager
  const ctx = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        throw new Error(`Unexpected dependency: ${token}`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    organizationScope: null,
  } as unknown as CommandRuntimeContext

  return { ctx, findOne }
}

describe('example todo prepare snapshot scoping (#3863)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    ['update', 'example.todos.update', { id: TODO_ID }],
    ['delete', 'example.todos.delete', { id: TODO_ID }],
  ])('scopes %s pre-image reads to the active tenant and organization', async (_name, commandId, input) => {
    const { ctx, findOne } = createCtx()

    await getCommand(commandId).prepare?.(input, ctx)

    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: TODO_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      }),
    )
  })
})
