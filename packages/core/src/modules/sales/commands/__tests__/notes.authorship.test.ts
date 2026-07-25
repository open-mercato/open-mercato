/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesNote, SalesOrder } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: (...args: unknown[]) => unknown }, entity: unknown, where: unknown) => {
    return em.findOne(entity, where)
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn(async () => undefined),
    emitCrudUndoSideEffects: jest.fn(async () => undefined),
  }
})

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOTE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CALLER_USER_ID = '11111111-1111-4111-8111-111111111111'
const SPOOFED_USER_ID = '22222222-2222-4222-8222-222222222222'
const ORIGINAL_USER_ID = '33333333-3333-4333-8333-333333333333'

function makeOrder() {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
  }
}

function makeNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: NOTE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    contextType: 'order',
    contextId: ORDER_ID,
    order: makeOrder(),
    quote: null,
    body: 'original',
    authorUserId: ORIGINAL_USER_ID,
    appearanceIcon: null,
    appearanceColor: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeEm(note?: ReturnType<typeof makeNote>) {
  const created: Array<Record<string, unknown>> = []
  const em: any = {
    fork: jest.fn(function () {
      return em
    }),
    findOne: jest.fn(async (entityClass: unknown, where: Record<string, unknown>) => {
      if (entityClass === SalesOrder && where.id === ORDER_ID) return makeOrder()
      if (entityClass === SalesNote && where.id === NOTE_ID) return note ?? null
      return null
    }),
    create: jest.fn((_entityClass: unknown, data: Record<string, unknown>) => {
      const row = { id: NOTE_ID, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    remove: jest.fn(),
  }
  return { em, created }
}

function makeCtx(
  em: Record<string, unknown>,
  auth: Record<string, unknown> = { tenantId: TENANT_ID, orgId: ORG_ID, sub: CALLER_USER_ID },
) {
  return {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        return {}
      }),
    },
    auth,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    organizationScope: null,
  }
}

describe('sales.notes command authorship', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../notes')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses the authenticated user, not client input, when creating a note', async () => {
    const execute = commandRegistry.get('sales.notes.create')?.execute
    expect(execute).toBeInstanceOf(Function)
    const { em, created } = makeEm()

    const result = await execute?.(
      {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        contextType: 'order',
        contextId: ORDER_ID,
        authorUserId: SPOOFED_USER_ID,
        body: 'Forged create',
      },
      makeCtx(em) as never,
    )

    expect(created[0]?.authorUserId).toBe(CALLER_USER_ID)
    expect(result?.authorUserId).toBe(CALLER_USER_ID)
  })

  it.each([
    ['API key auth', { tenantId: TENANT_ID, orgId: ORG_ID, isApiKey: true, sub: CALLER_USER_ID }],
    ['non-UUID auth subject', { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'system-user' }],
  ])('stores a null author for %s even when client input supplies authorUserId', async (_label, auth) => {
    const execute = commandRegistry.get('sales.notes.create')?.execute
    const { em, created } = makeEm()

    const result = await execute?.(
      {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        contextType: 'order',
        contextId: ORDER_ID,
        authorUserId: SPOOFED_USER_ID,
        body: 'System create',
      },
      makeCtx(em, auth) as never,
    )

    expect(created[0]?.authorUserId).toBeNull()
    expect(result?.authorUserId).toBeNull()
  })

  it('uses the authenticated user, not client input, when updating note authorship', async () => {
    const execute = commandRegistry.get('sales.notes.update')?.execute
    expect(execute).toBeInstanceOf(Function)
    const note = makeNote()
    const { em } = makeEm(note)

    await execute?.(
      {
        id: NOTE_ID,
        authorUserId: SPOOFED_USER_ID,
        body: 'Updated',
      },
      makeCtx(em) as never,
    )

    expect(note.authorUserId).toBe(CALLER_USER_ID)
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, SalesNote, { id: NOTE_ID }, {})
  })

  it('preserves the existing author on body-only updates', async () => {
    const execute = commandRegistry.get('sales.notes.update')?.execute
    const note = makeNote()
    const { em } = makeEm(note)

    await execute?.({ id: NOTE_ID, body: 'Body-only edit' }, makeCtx(em) as never)

    expect(note.authorUserId).toBe(ORIGINAL_USER_ID)
  })
})
