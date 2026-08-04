jest.mock('@open-mercato/shared/lib/query/engine', () => ({
  BasicQueryEngine: jest.fn().mockImplementation(() => ({})),
  resolveEntityTableName: jest.fn(() => 'customers_people'),
}))

import { register } from '../di'
import { CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY } from '@open-mercato/shared/lib/crud/types'

function makeBuilder(result: unknown, mode: 'many' | 'one') {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    distinct: jest.fn(() => builder),
    where: jest.fn(() => builder),
    execute: jest.fn(async () => (mode === 'many' ? result : [])),
    executeTakeFirst: jest.fn(async () => (mode === 'one' ? result : undefined)),
  }
  return builder
}

async function flushRegistration() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('query_index DI CRUD bridge', () => {
  it('does not duplicate upsert or delete work owned by the data engine', async () => {
    const handlers = new Map<string, (payload: unknown, ctx: unknown) => Promise<void>>()
    const emitEvent = jest.fn(async () => {})
    const eventBus = {
      on: jest.fn((event: string, handler: (payload: unknown, ctx: unknown) => Promise<void>) => {
        handlers.set(event, handler)
      }),
      emitEvent,
    }
    const db = {
      selectFrom: jest.fn(() => makeBuilder([{ entity_id: 'customers:person' }], 'many')),
    }
    const em = { getKysely: () => db }
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'eventBus') return eventBus
        return null
      }),
      register: jest.fn(),
    }

    register(container as never)
    await flushRegistration()

    for (const eventName of ['customers.person.created', 'customers.person.deleted']) {
      const handler = handlers.get(eventName)
      expect(handler).toBeDefined()
      await handler!({
        id: 'person-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        [CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY]: true,
      }, {
        resolve: container.resolve,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
    }

    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('forwards tenant scope on delete events when the payload omits it', async () => {
    const handlers = new Map<string, (payload: unknown, ctx: unknown) => Promise<void>>()
    const emitEvent = jest.fn(async () => {})
    const eventBus = {
      on: jest.fn((event: string, handler: (payload: unknown, ctx: unknown) => Promise<void>) => {
        handlers.set(event, handler)
      }),
      emitEvent,
    }

    const db = {
      selectFrom: jest.fn((table: string) => {
        if (table === 'custom_field_defs') {
          return makeBuilder([{ entity_id: 'customers:person' }], 'many')
        }
        return makeBuilder(
          {
            organization_id: 'org-1',
            tenant_id: 'tenant-1',
          },
          'one',
        )
      }),
    }
    const em = { getKysely: () => db }
    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'eventBus') return eventBus
        return null
      }),
      register: jest.fn(),
    }

    register(container as never)
    await flushRegistration()

    const handler = handlers.get('customers.person.deleted')
    expect(handler).toBeDefined()

    await handler!({ id: 'person-1', organizationId: 'org-1' }, {
      resolve: container.resolve,
      tenantId: null,
      organizationId: 'org-1',
    })

    expect(emitEvent).toHaveBeenCalledWith('query_index.delete_one', {
      entityType: 'customers:person',
      recordId: 'person-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
  })
})
