/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerInteraction, CustomerTodoLink } from '../../data/entities'
import { countCustomerTodos } from '../todoCompatibility'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

jest.mock('../interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(),
  loadCustomerSummaries: jest.fn(),
}))

const findWithDecryptionMock = jest.mocked(findWithDecryption)
const scope = {
  entityId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
}
const entityScope = {
  entity: scope.entityId,
  tenantId: scope.tenantId,
  organizationId: scope.organizationId,
}

function createEm(total: number) {
  const count = jest.fn(async () => total)
  return { em: { count } as unknown as EntityManager, count }
}

describe('countCustomerTodos', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockResolvedValue([])
  })

  it('counts two adapter-created tasks without legacy links (#6068)', async () => {
    const { em, count } = createEm(0)
    findWithDecryptionMock.mockResolvedValue([
      { id: 'adapter-1', deletedAt: null },
      { id: 'adapter-2', deletedAt: null },
    ])

    await expect(countCustomerTodos(em, scope, false)).resolves.toBe(2)

    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      em,
      CustomerInteraction,
      { ...entityScope, interactionType: 'task', source: 'adapter:todo' },
      { fields: ['id', 'deletedAt'] },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    expect(count).toHaveBeenCalledWith(CustomerTodoLink, {
      ...entityScope,
      todoId: { $nin: ['adapter-1', 'adapter-2'] },
    })
  })

  it('preserves the scoped legacy-link total when no adapter tasks exist', async () => {
    const { em, count } = createEm(5)

    await expect(countCustomerTodos(em, scope, false)).resolves.toBe(5)

    expect(count).toHaveBeenCalledWith(CustomerTodoLink, entityScope)
  })

  it('counts active bridges once and suppresses legacy links for deleted bridges', async () => {
    const { em, count } = createEm(1)
    findWithDecryptionMock.mockResolvedValue([
      { id: 'active-bridge', deletedAt: null },
      { id: 'deleted-bridge', deletedAt: new Date('2026-10-01T10:00:00.000Z') },
    ])

    await expect(countCustomerTodos(em, scope, false)).resolves.toBe(2)

    expect(count).toHaveBeenCalledWith(CustomerTodoLink, {
      ...entityScope,
      todoId: { $nin: ['active-bridge', 'deleted-bridge'] },
    })
  })

  it('does not count deleted adapter tasks or resurrect their legacy links', async () => {
    const { em, count } = createEm(0)
    findWithDecryptionMock.mockResolvedValue([
      { id: 'deleted-bridge', deletedAt: new Date('2026-10-01T10:00:00.000Z') },
    ])

    await expect(countCustomerTodos(em, scope, false)).resolves.toBe(0)

    expect(count).toHaveBeenCalledWith(CustomerTodoLink, {
      ...entityScope,
      todoId: { $nin: ['deleted-bridge'] },
    })
  })

  it('counts beyond the overview preview limit', async () => {
    const { em, count } = createEm(2)
    const adapters = Array.from({ length: 125 }, (_, index) => ({
      id: `adapter-${index}`,
      deletedAt: null,
    }))
    findWithDecryptionMock.mockResolvedValue(adapters)

    await expect(countCustomerTodos(em, scope, false)).resolves.toBe(127)

    expect(findWithDecryptionMock.mock.calls[0][3]).toEqual({ fields: ['id', 'deletedAt'] })
    expect(count).toHaveBeenCalledWith(CustomerTodoLink, {
      ...entityScope,
      todoId: { $nin: adapters.map((adapter) => adapter.id) },
    })
  })

  it('counts all active canonical task sources with explicit scope in unified mode', async () => {
    const { em, count } = createEm(205)

    await expect(countCustomerTodos(em, scope, true)).resolves.toBe(205)

    expect(count).toHaveBeenCalledWith(CustomerInteraction, {
      ...entityScope,
      interactionType: 'task',
      deletedAt: null,
    })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })
})
